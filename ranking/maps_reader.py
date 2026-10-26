"""Lectura de nota y número de reseñas de un centro en Google Maps.

ESTE ES EL ÚNICO ARCHIVO QUE TOCA GOOGLE MAPS. Todo lo demás (ranking,
almacenamiento, programación) no sabe de dónde salen los datos.

Cómo funciona hoy: abre la ficha con Playwright y lee dos `aria-label` de la
página ("737 reseñas" y "5,0 estrellas"). Es un método frágil (si Google cambia
esos textos deja de funcionar) y va contra las condiciones de uso de Google
Maps. Para sustituirlo por la Google Places API basta con reimplementar
`leer_google_maps` devolviendo el mismo diccionario:
    rating            -> "nota"
    userRatingCount   -> "resenas"
y quitar Playwright de `sinvello_ranking.py`. Mientras tanto, siempre se
rechazan las cookies de Google (la opción más privada).
"""

import re

# Tipo de dato que devuelve leer_google_maps:
#   {"nombre": str, "resenas": int, "nota": float | None}


class LecturaError(Exception):
    """No se pudo leer el centro (página sin datos, timeout...)."""


class BloqueoGoogle(LecturaError):
    """Google pide verificación anti-robot (página /sorry/ o captcha). No se
    reintenta: insistir solo empeora el bloqueo."""


def parse_resenas(texto):
    """'1.234 reseñas' -> 1234 (quita todo lo que no sea dígito)."""
    digitos = re.sub(r"\D", "", texto or "")
    return int(digitos) if digitos else None


def parse_nota(texto):
    """'5,0 estrellas' -> 5.0 (coma decimal española)."""
    m = re.search(r"(\d+(?:[.,]\d+)?)", texto or "")
    return float(m.group(1).replace(",", ".")) if m else None


# Espera a que aparezca el aria-label de reseñas (o el texto "Sin reseñas").
_JS_LISTO = r"""() => [...document.querySelectorAll('[aria-label]')]
    .some(e => /^[\d.\s ]+ reseñas?$/.test(e.getAttribute('aria-label')))
    || /Sin reseñas/.test(document.body.innerText)"""

# Lee los dos aria-label y el nombre (h1).
_JS_LEER = r"""() => {
    const l = [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label'));
    return {
        nombre: document.querySelector('h1')?.innerText || document.title,
        resenas: l.find(a => /^[\d.\s ]+ reseñas?$/.test(a)) || null,
        nota: l.find(a => /^[\d,.]+ estrellas?\s*$/.test(a)) || null,
        sinResenas: /Sin reseñas/.test(document.body.innerText),
    };
}"""


def _es_bloqueo(url):
    """Google redirige a /sorry/ (o recaptcha) cuando sospecha de un robot."""
    return "google.com/sorry" in url or "/recaptcha/" in url


async def _rechazar_cookies(page):
    """Si Google muestra su página de consentimiento: 'Rechazar todo'."""
    if "consent.google" not in page.url:
        return
    try:
        await page.get_by_role("button", name=re.compile("Rechazar todo", re.I)).first.click(timeout=8000)
    except Exception:
        pass


async def leer_google_maps(contexto, url, timeout_ms=45000, intentos=2):
    """Abre `url` (ficha de Google Maps) y devuelve nombre, reseñas y nota.

    Lanza LecturaError si no consigue leer el número de reseñas.
    """
    page = await contexto.new_page()
    try:
        ultimo_error = "sin datos"
        for _ in range(intentos):
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                await _rechazar_cookies(page)
                if _es_bloqueo(page.url):
                    raise BloqueoGoogle("Google pide verificación anti-robot")
                await page.wait_for_function(_JS_LISTO, timeout=20000)
                datos = await page.evaluate(_JS_LEER)
            except BloqueoGoogle:
                raise
            except Exception as e:  # timeout, navegación fallida...
                if _es_bloqueo(page.url):
                    raise BloqueoGoogle("Google pide verificación anti-robot")
                ultimo_error = str(e).splitlines()[0][:120]
                continue

            resenas = parse_resenas(datos["resenas"])
            if resenas is None and datos["sinResenas"]:
                resenas = 0
            if resenas is None:
                ultimo_error = "no aparece el número de reseñas"
                continue
            return {
                "nombre": datos["nombre"] or "",
                "resenas": resenas,
                "nota": parse_nota(datos["nota"]),
            }
        raise LecturaError(ultimo_error)
    finally:
        await page.close()
