"""Ranking mensual de los centros SinVello! por NÚMERO TOTAL de reseñas de Google.

Un solo proceso, de principio a fin:
  1. Descarga el sitemap de la web oficial y se queda con las fichas de centros.
  2. Lee cada ficha para sacar el enlace a Google Maps (cid).
  3. Lee nota y reseñas en Google Maps (ver maps_reader.py), con calma para que
     Google no bloquee: 2 pestañas a la vez, pausas aleatorias y freno de
     emergencia si Google empieza a rechazar. Para no pedir de más, solo se
     leen los candidatos al top 50 (los 80 primeros de la última captura, el
     centro propio y los centros nuevos); una captura COMPLETA (todos los
     centros) se hace la primera vez y luego cada 6 meses o con --completo.
  4. Si algún centro falla, conserva su último valor bueno y lo registra.
  5. Ordena por reseñas y guarda el top 50 (con "madrid-alcorcon" siempre incluido
     y marcado), más la captura fechada y el log.

Si falla más del 10 % de los centros consultados NO se publica el ranking nuevo: se mantiene
el anterior y el proceso termina con código 2 (la Action de GitHub falla y avisa).

Uso:
    python ranking/sinvello_ranking.py                      # captura real (candidatos; completa si toca)
    python ranking/sinvello_ranking.py --completo           # fuerza leer todos los centros
    python ranking/sinvello_ranking.py --canal msedge       # en Windows con Edge
    python ranking/sinvello_ranking.py --limite 12          # prueba rápida (no toca los datos reales)
"""

import argparse
import asyncio
import concurrent.futures as cf
import html
import json
import random
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from maps_reader import BloqueoGoogle, LecturaError, leer_google_maps

SITEMAP_URL = "https://sinvelloporlaser.es/sitemap_metaobject_pages_1.xml"
RUTA_FICHAS = "/pages/tiendas/"
SLUG_NUESTRO = "madrid-alcorcon"
TOP_N = 50
UMBRAL_FALLOS = 0.10        # más de esto sin leer -> no se publica
CONCURRENCIA = 2            # pestañas de Google Maps a la vez (poca, para no llamar la atención)
PAUSA_S = (1.0, 3.5)        # pausa aleatoria antes de abrir cada centro
MAX_FALLOS_SEGUIDOS = 8     # freno de emergencia: tantos fallos seguidos y se deja de insistir
CANDIDATOS_TOP = 80         # en capturas parciales: los N primeros de la última captura
COMPLETA_CADA_DIAS = 180    # cada cuánto se leen TODOS los centros
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

DIR_DATOS = Path(__file__).resolve().parent / "data"


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- utilidades puras

def limpiar_nombre(crudo, slug=""):
    """'SinVello! Málaga - Teatinos | Depilación láser' -> 'Málaga - Teatinos'."""
    n = html.unescape(crudo or "")
    n = re.sub(r"\s+-\s+Google Maps\s*$", "", n)
    n = n.split("|")[0]
    n = re.sub(r"^\s*sinvello\s*!?\s*", "", n, flags=re.I)
    n = re.sub(r"\s+", " ", n).strip(" -–")
    return n or slug.replace("-", " ").title()


def urls_de_fichas(xml):
    """URLs de centros (/pages/tiendas/) del sitemap, sin repetir y ordenadas."""
    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml or "")
    return sorted({html.unescape(u) for u in locs if RUTA_FICHAS in u})


def datos_de_ficha(url, texto):
    """Slug y enlace a Google Maps de una ficha: cid, o el enlace largo /maps/place/."""
    cid = re.search(r"google\.com/maps\?cid=(\d+)", texto or "")
    largo = re.search(r'href="(https://www\.google\.com/maps/place/[^"]+)"', texto or "")
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    if cid:
        maps = f"https://www.google.com/maps?cid={cid.group(1)}&hl=es"
    elif largo:
        enlace = html.unescape(largo.group(1))
        maps = enlace + ("&" if "?" in enlace else "?") + "hl=es"
    else:
        maps = None
    return {"slug": slug, "url": url, "maps": maps}


def dias_entre(desde, hasta):
    """Días entre dos fechas 'AAAA-MM-DD' (None si falta alguna)."""
    try:
        return (datetime.strptime(hasta, "%Y-%m-%d") - datetime.strptime(desde, "%Y-%m-%d")).days
    except (TypeError, ValueError):
        return None


def elegir_a_leer(tiendas, estado, meta, hoy, completo=False, top=CANDIDATOS_TOP, nuestro=SLUG_NUESTRO):
    """Qué centros leer en Google esta vez. Devuelve (lista_de_tiendas, modo).

    Completa (todos): se pide con --completo, no hay datos previos, o la última
    captura completa fue hace más de COMPLETA_CADA_DIAS días.
    Parcial: los `top` primeros por reseñas de la última captura, el centro
    propio y los centros que aún no tienen ningún dato.
    """
    antiguedad = dias_entre((meta or {}).get("ultimo_completo"), hoy)
    if completo or not estado or antiguedad is None or antiguedad >= COMPLETA_CADA_DIAS:
        return list(tiendas), "completo"

    actuales = {t["slug"] for t in tiendas}
    mejores = sorted((s for s in estado if s in actuales), key=lambda s: -estado[s]["resenas"])[:top]
    elegidos = set(mejores) | {nuestro}
    return [t for t in tiendas if t["slug"] in elegidos or t["slug"] not in estado], "candidatos"


class Cortacircuitos:
    """Freno de emergencia: tras N fallos seguidos (o un bloqueo de Google) deja
    de abrir más centros, para no empeorar un posible bloqueo."""

    def __init__(self, maximo=MAX_FALLOS_SEGUIDOS):
        self.maximo = maximo
        self.seguidos = 0
        self.abierto = False
        self.motivo = ""

    def registrar(self, ok, bloqueo=False):
        if ok:
            self.seguidos = 0
            return
        self.seguidos += 1
        if bloqueo:
            self.abierto, self.motivo = True, "Google pide verificación anti-robot"
        elif self.seguidos >= self.maximo:
            self.abierto, self.motivo = True, f"{self.seguidos} fallos seguidos"


def combinar(estado, tiendas, lecturas, hoy):
    """Actualiza el estado con lo leído esta vez y conserva lo anterior si falla.

    estado:   {slug: {nombre, resenas, nota, ultimo_ok}} de la captura anterior
    tiendas:  lista de centros actuales (sitemap), cada uno con "slug"
    lecturas: {slug: {nombre, resenas, nota} | {error}} SOLO de los centros
              consultados esta vez; los demás conservan su valor sin más
    Devuelve (estado_nuevo, leidos, desactualizados, incidencias).
    """
    nuevo = {}
    leidos = 0
    desactualizados = []
    incidencias = []
    for t in tiendas:
        slug = t["slug"]
        if slug not in lecturas:  # no consultado esta vez
            if slug in estado:
                nuevo[slug] = estado[slug]
            continue
        lec = lecturas[slug]
        if "error" not in lec:
            leidos += 1
            nuevo[slug] = {
                "nombre": limpiar_nombre(lec["nombre"], slug),
                "resenas": lec["resenas"],
                "nota": lec["nota"],
                "ultimo_ok": hoy,
            }
            continue
        previo = estado.get(slug)
        if previo:
            nuevo[slug] = previo
            desactualizados.append(slug)
            incidencias.append({"slug": slug, "motivo": lec["error"],
                                "accion": f"se conserva el valor del {previo['ultimo_ok']}"})
        else:
            incidencias.append({"slug": slug, "motivo": lec["error"], "accion": "sin dato, fuera del ranking"})
    return nuevo, leidos, desactualizados, incidencias


def construir_ranking(estado, slugs_actuales, top=TOP_N, nuestro=SLUG_NUESTRO):
    """Top N por reseñas (desc). Desempate: nota y luego nombre. El centro propio
    siempre aparece: si queda fuera del top, va al final con su puesto real."""
    filas = [dict(slug=s, **estado[s]) for s in slugs_actuales if s in estado]
    filas.sort(key=lambda f: (-f["resenas"], -(f["nota"] or 0), f["nombre"].lower()))

    def fila(pos, f):
        return {"puesto": pos, "nombre": f["nombre"], "slug": f["slug"], "reseñas": f["resenas"],
                "nota": f["nota"], "es_nuestro": f["slug"] == nuestro}

    ranking = [fila(i + 1, f) for i, f in enumerate(filas[:top])]
    if nuestro not in {r["slug"] for r in ranking}:
        for i, f in enumerate(filas):
            if f["slug"] == nuestro:
                ranking.append(fila(i + 1, f))
                break
    return ranking


def decidir_publicacion(total, leidos, umbral=UMBRAL_FALLOS):
    """(publicar, fraccion_de_fallos). Sin centros o con demasiados fallos: no."""
    if total <= 0:
        return False, 1.0
    fallos = (total - leidos) / total
    return fallos <= umbral, fallos


# ---------------------------------------------------------------- red

def descargar(url, intentos=3, timeout=40):
    error = None
    for k in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
        except Exception as e:
            error = e
            time.sleep(1.5 * (k + 1))
    raise RuntimeError(f"No se pudo descargar {url}: {error}")


def leer_fichas(urls):
    def una(u):
        try:
            return datos_de_ficha(u, descargar(u))
        except Exception as e:
            return {"slug": u.rstrip("/").rsplit("/", 1)[-1], "url": u, "maps": None, "error": str(e)[:100]}
    with cf.ThreadPoolExecutor(8) as ex:
        return list(ex.map(una, urls))


async def leer_todos(tiendas, canal, concurrencia):
    """Lee Google Maps de los centros dados. Devuelve {slug: lectura | {error}}.

    Con calma: pocas pestañas a la vez, pausa aleatoria antes de cada centro y
    freno de emergencia (ver Cortacircuitos) para no insistir si Google rechaza.
    """
    from playwright.async_api import async_playwright

    resultados = {}
    sem = asyncio.Semaphore(concurrencia)
    freno = Cortacircuitos()

    async def uno(ctx, t, total):
        async with sem:
            if freno.abierto:
                resultados[t["slug"]] = {"error": f"no consultado: {freno.motivo}"}
            elif not t["maps"]:
                resultados[t["slug"]] = {"error": t.get("error") or "la ficha no tiene enlace a Google Maps"}
            else:
                await asyncio.sleep(random.uniform(*PAUSA_S))
                bloqueo = False
                try:
                    resultados[t["slug"]] = await leer_google_maps(ctx, t["maps"])
                except BloqueoGoogle as e:
                    bloqueo = True
                    resultados[t["slug"]] = {"error": str(e)}
                except LecturaError as e:
                    resultados[t["slug"]] = {"error": str(e)}
                except Exception as e:
                    resultados[t["slug"]] = {"error": str(e).splitlines()[0][:120]}
                freno.registrar("error" not in resultados[t["slug"]], bloqueo)
                if freno.abierto and freno.seguidos in (1, freno.maximo):
                    log(f"  !! FRENO DE EMERGENCIA: {freno.motivo}. Se deja de consultar.")
            r = resultados[t["slug"]]
            estado = f"{r['resenas']} reseñas, nota {r['nota']}" if "error" not in r else f"ERROR: {r['error']}"
            log(f"  [{len(resultados)}/{total}] {t['slug']}: {estado}")

    async with async_playwright() as pw:
        opciones = {"headless": True}
        if canal:
            opciones["channel"] = canal  # p. ej. "msedge" en Windows; en el servidor, Chromium de Playwright
        navegador = await pw.chromium.launch(**opciones)
        ctx = await navegador.new_context(locale="es-ES", user_agent=UA)
        await asyncio.gather(*[uno(ctx, t, len(tiendas)) for t in tiendas])
        await navegador.close()
    return resultados


# ---------------------------------------------------------------- almacenamiento

def cargar_json(ruta, defecto):
    try:
        return json.loads(Path(ruta).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return defecto


def guardar_json(ruta, datos):
    Path(ruta).parent.mkdir(parents=True, exist_ok=True)
    Path(ruta).write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def anotar_log(directorio, entrada):
    Path(directorio).mkdir(parents=True, exist_ok=True)
    with open(Path(directorio) / "log.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(entrada, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- proceso completo

def ejecutar(canal=None, limite=None, directorio=DIR_DATOS, concurrencia=CONCURRENCIA, ahora=None, completo=False):
    ahora = ahora or datetime.now(timezone.utc)
    hoy = ahora.strftime("%Y-%m-%d")

    log("1/4 Sitemap de centros…")
    urls = urls_de_fichas(descargar(SITEMAP_URL))
    if not urls:
        raise RuntimeError("El sitemap no trae ningún centro (¿cambió la web?).")
    if limite:
        urls = urls[:limite]
    log(f"    {len(urls)} centros")

    log("2/4 Fichas (enlace a Google Maps)…")
    tiendas = leer_fichas(urls)
    sin_enlace = [t["slug"] for t in tiendas if not t["maps"]]
    if sin_enlace:
        log(f"    sin enlace a Maps: {', '.join(sin_enlace)}")

    estado_previo = cargar_json(Path(directorio) / "estado.json", {})
    meta = cargar_json(Path(directorio) / "meta.json", {})
    a_leer, modo = elegir_a_leer(tiendas, estado_previo, meta, hoy, completo=completo)
    log(f"3/4 Google Maps (nota y reseñas): captura {modo.upper()}, {len(a_leer)} de {len(tiendas)} centros…")
    lecturas = asyncio.run(leer_todos(a_leer, canal, concurrencia))

    log("4/4 Ranking…")
    estado, leidos, desactualizados, incidencias = combinar(estado_previo, tiendas, lecturas, hoy)
    consultados = len(a_leer)
    publicar, fallos = decidir_publicacion(consultados, leidos)

    entrada_log = {"fecha": hoy, "capturado_en": ahora.isoformat(timespec="seconds"), "modo": modo,
                   "centros_leidos": leidos, "centros_consultados": consultados, "centros_total": len(tiendas),
                   "publicado": publicar, "incidencias": incidencias}
    if not publicar:
        anotar_log(directorio, entrada_log)
        log(f"NO SE PUBLICA: fallaron {consultados - leidos} de {consultados} centros consultados ({fallos:.0%}, máximo {UMBRAL_FALLOS:.0%}). Se mantiene el ranking anterior.")
        return 2

    ranking = construir_ranking(estado, [t["slug"] for t in tiendas])
    if SLUG_NUESTRO not in {r["slug"] for r in ranking}:
        incidencias.append({"slug": SLUG_NUESTRO, "motivo": "no hay dato del centro propio", "accion": "no aparece en el ranking"})
        entrada_log["incidencias"] = incidencias

    captura = {"fecha": hoy, "capturado_en": ahora.isoformat(timespec="seconds"), "modo": modo,
               "centros_leidos": leidos, "centros_consultados": consultados, "centros_total": len(tiendas),
               "publicado": True,
               "centros_desactualizados": desactualizados, "ranking": ranking, "incidencias": incidencias}
    guardar_json(Path(directorio) / "latest.json", captura)
    guardar_json(Path(directorio) / "capturas" / f"{hoy}.json", captura)
    guardar_json(Path(directorio) / "estado.json", estado)
    if modo == "completo":
        guardar_json(Path(directorio) / "meta.json", {"ultimo_completo": hoy})
    anotar_log(directorio, entrada_log)
    log(f"Publicado: {len(ranking)} centros en el ranking · leídos {leidos}/{consultados} consultados (de {len(tiendas)}) · "
        f"{len(desactualizados)} con valor anterior · {len(incidencias)} incidencias")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--canal", default=None, help='navegador instalado a usar (p. ej. "msedge"); por defecto el Chromium de Playwright')
    p.add_argument("--limite", type=int, default=None, help="solo los N primeros centros (prueba; escribe en data/_prueba)")
    p.add_argument("--salida", default=None, help="carpeta de datos (por defecto ranking/data)")
    p.add_argument("--concurrencia", type=int, default=CONCURRENCIA)
    p.add_argument("--completo", action="store_true", help="leer TODOS los centros (por defecto solo los candidatos al top 50)")
    a = p.parse_args(argv)
    directorio = Path(a.salida) if a.salida else (DIR_DATOS / "_prueba" if a.limite else DIR_DATOS)
    return ejecutar(canal=a.canal, limite=a.limite, directorio=directorio, concurrencia=a.concurrencia, completo=a.completo)


if __name__ == "__main__":
    sys.exit(main())
