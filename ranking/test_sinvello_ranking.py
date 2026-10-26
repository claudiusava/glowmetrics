"""Pruebas del ranking (sin red ni navegador). Ejecutar:
    python -m unittest discover -s ranking -v
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import sinvello_ranking as sr
from maps_reader import parse_nota, parse_resenas

SITEMAP = """<?xml version="1.0"?><urlset>
<url><loc>https://sinvelloporlaser.es/pages/tiendas/madrid-alcorcon</loc></url>
<url><loc>https://sinvelloporlaser.es/pages/tiendas/malaga-teatinos</loc></url>
<url><loc>https://sinvelloporlaser.es/pages/provincia/madrid</loc></url>
<url><loc>https://sinvelloporlaser.es/pages/tiendas/malaga-teatinos</loc></url>
<url><loc> https://sinvelloporlaser.es/pages/tiendas/avila-avila </loc></url>
</urlset>"""


class Parseo(unittest.TestCase):
    def test_resenas_con_punto_de_miles(self):
        self.assertEqual(parse_resenas("737 reseñas"), 737)
        self.assertEqual(parse_resenas("1.234 reseñas"), 1234)
        self.assertEqual(parse_resenas("1 reseña"), 1)
        self.assertEqual(parse_resenas("2 025 reseñas"), 2025)
        self.assertIsNone(parse_resenas(None))
        self.assertIsNone(parse_resenas("Sin reseñas"))

    def test_nota_con_coma_decimal(self):
        self.assertEqual(parse_nota("5,0 estrellas"), 5.0)
        self.assertEqual(parse_nota("4,9 estrellas "), 4.9)
        self.assertEqual(parse_nota("4 estrellas"), 4.0)
        self.assertIsNone(parse_nota(None))

    def test_nombre_sin_prefijo_ni_sufijo(self):
        self.assertEqual(sr.limpiar_nombre("SinVello! Málaga - Teatinos | Depilación Láser"), "Málaga - Teatinos")
        self.assertEqual(sr.limpiar_nombre("Sinvello! Madrid - Alcorcón"), "Madrid - Alcorcón")
        self.assertEqual(sr.limpiar_nombre("  SinVello!   Barcelona - El Clot  - Google Maps"), "Barcelona - El Clot")
        self.assertEqual(sr.limpiar_nombre("", "malaga-teatinos"), "Malaga Teatinos")

    def test_sitemap_solo_fichas_de_centros(self):
        urls = sr.urls_de_fichas(SITEMAP)
        self.assertEqual(len(urls), 3)  # sin /provincia/ y sin repetidos
        self.assertTrue(all("/pages/tiendas/" in u for u in urls))
        self.assertEqual(urls, sorted(urls))

    def test_ficha_con_cid(self):
        t = sr.datos_de_ficha("https://x.es/pages/tiendas/madrid-alcorcon",
                              '<a href="https://www.google.com/maps?cid=12345678901234567">VER RESEÑAS</a>')
        self.assertEqual(t["slug"], "madrid-alcorcon")
        self.assertEqual(t["maps"], "https://www.google.com/maps?cid=12345678901234567&hl=es")

    def test_ficha_solo_con_enlace_largo(self):
        t = sr.datos_de_ficha("https://x.es/pages/tiendas/avila-avila",
                              '<a href="https://www.google.com/maps/place/SinVello/@40.6,-4.7,17z/data=!4m2&amp;x=1">Maps</a>')
        self.assertTrue(t["maps"].startswith("https://www.google.com/maps/place/SinVello/@40.6"))
        self.assertIn("&x=1", t["maps"])           # &amp; desescapado
        self.assertTrue(t["maps"].endswith("hl=es"))

    def test_ficha_sin_enlace(self):
        self.assertIsNone(sr.datos_de_ficha("https://x.es/pages/tiendas/albacete-albacete-centro", "<html></html>")["maps"])


def estado_de(*filas):
    return {s: {"nombre": s.title(), "resenas": r, "nota": n, "ultimo_ok": "2026-10-19"} for s, r, n in filas}


class Ranking(unittest.TestCase):
    def test_orden_por_resenas_y_desempate(self):
        e = estado_de(("a", 100, 4.9), ("b", 300, 4.5), ("c", 100, 5.0), ("d", 100, 5.0))
        r = sr.construir_ranking(e, list(e))
        self.assertEqual([x["slug"] for x in r], ["b", "c", "d", "a"])  # reseñas desc; luego nota desc; luego nombre
        self.assertEqual([x["puesto"] for x in r], [1, 2, 3, 4])

    def test_solo_top_50(self):
        e = estado_de(*[(f"c{i:03d}", 1000 - i, 5.0) for i in range(80)])
        r = sr.construir_ranking(e, list(e))
        self.assertEqual(len(r), 50)

    def test_campos_del_ranking(self):
        e = estado_de(("madrid-alcorcon", 902, 5.0), ("otro", 10, 4.0))
        r = sr.construir_ranking(e, list(e))
        self.assertEqual(set(r[0]), {"puesto", "nombre", "slug", "reseñas", "nota", "es_nuestro"})
        self.assertIs(r[0]["es_nuestro"], True)
        self.assertIs(r[1]["es_nuestro"], False)
        self.assertIsInstance(r[0]["reseñas"], int)

    def test_nuestro_fuera_del_top_va_al_final_con_su_puesto_real(self):
        e = estado_de(*[(f"c{i:03d}", 1000 - i, 5.0) for i in range(60)], ("madrid-alcorcon", 935, 5.0))
        r = sr.construir_ranking(e, list(e))
        self.assertEqual(len(r), 51)
        ultimo = r[-1]
        self.assertEqual((ultimo["slug"], ultimo["puesto"], ultimo["es_nuestro"]), ("madrid-alcorcon", 61, True))
        self.assertEqual(sum(1 for x in r if x["es_nuestro"]), 1)

    def test_nuestro_dentro_del_top_no_se_duplica(self):
        e = estado_de(("madrid-alcorcon", 902, 5.0), ("a", 10, 5.0))
        r = sr.construir_ranking(e, list(e))
        self.assertEqual(sum(1 for x in r if x["slug"] == "madrid-alcorcon"), 1)

    def test_centros_que_ya_no_estan_en_el_sitemap_no_salen(self):
        e = estado_de(("a", 5, 5.0), ("cerrado", 999, 5.0))
        r = sr.construir_ranking(e, ["a"])
        self.assertEqual([x["slug"] for x in r], ["a"])


class Combinar(unittest.TestCase):
    def test_conserva_el_ultimo_valor_bueno_y_lo_registra(self):
        previo = estado_de(("a", 100, 5.0), ("b", 200, 4.8))
        tiendas = [{"slug": "a"}, {"slug": "b"}, {"slug": "nuevo"}, {"slug": "sin-dato"}]
        lecturas = {"a": {"nombre": "SinVello! A | x", "resenas": 110, "nota": 5.0},
                    "b": {"error": "timeout"},
                    "nuevo": {"nombre": "SinVello! Nuevo", "resenas": 7, "nota": 4.7},
                    "sin-dato": {"error": "la ficha no tiene enlace a Google Maps"}}
        estado, leidos, viejos, inc = sr.combinar(previo, tiendas, lecturas, "2026-10-26")
        self.assertEqual(leidos, 2)
        self.assertEqual(estado["a"]["resenas"], 110)
        self.assertEqual(estado["a"]["ultimo_ok"], "2026-10-26")
        self.assertEqual(estado["b"]["resenas"], 200)            # valor anterior
        self.assertEqual(estado["b"]["ultimo_ok"], "2026-10-19")
        self.assertEqual(viejos, ["b"])
        self.assertEqual(estado["nuevo"]["nombre"], "Nuevo")      # centro nuevo entra solo
        self.assertNotIn("sin-dato", estado)
        self.assertEqual({i["slug"] for i in inc}, {"b", "sin-dato"})

    def test_regla_del_10_por_ciento(self):
        self.assertEqual(sr.decidir_publicacion(204, 201)[0], True)
        self.assertEqual(sr.decidir_publicacion(100, 90)[0], True)    # justo 10 %
        self.assertEqual(sr.decidir_publicacion(100, 89)[0], False)   # 11 %
        self.assertEqual(sr.decidir_publicacion(0, 0)[0], False)


class ElegirQueLeer(unittest.TestCase):
    def tiendas(self, n, extra=()):
        return [{"slug": f"c{i:03d}", "maps": "x"} for i in range(n)] + [{"slug": s, "maps": "x"} for s in extra]

    def estado(self, n, extra=()):
        e = {f"c{i:03d}": {"nombre": f"C{i}", "resenas": 1000 - i, "nota": 5.0, "ultimo_ok": "2026-10-01"} for i in range(n)}
        for s in extra:
            e[s] = {"nombre": s, "resenas": 5, "nota": 5.0, "ultimo_ok": "2026-10-01"}
        return e

    def test_sin_datos_previos_lee_todos(self):
        a_leer, modo = sr.elegir_a_leer(self.tiendas(200), {}, {}, "2026-11-01")
        self.assertEqual((modo, len(a_leer)), ("completo", 200))

    def test_parcial_lee_candidatos_propio_y_nuevos(self):
        tiendas = self.tiendas(200, extra=("madrid-alcorcon", "centro-nuevo"))
        estado = self.estado(200, extra=("madrid-alcorcon",))          # alcorcon con pocas reseñas: fuera del top 80
        a_leer, modo = sr.elegir_a_leer(tiendas, estado, {"ultimo_completo": "2026-10-01"}, "2026-11-01")
        slugs = {t["slug"] for t in a_leer}
        self.assertEqual(modo, "candidatos")
        self.assertEqual(len(slugs), sr.CANDIDATOS_TOP + 2)             # 80 + propio + nuevo
        self.assertIn("madrid-alcorcon", slugs)
        self.assertIn("centro-nuevo", slugs)
        self.assertIn("c000", slugs)
        self.assertNotIn("c150", slugs)

    def test_completo_si_pasaron_seis_meses_o_se_pide(self):
        tiendas, estado = self.tiendas(200), self.estado(200)
        self.assertEqual(sr.elegir_a_leer(tiendas, estado, {"ultimo_completo": "2026-04-01"}, "2026-11-01")[1], "completo")
        self.assertEqual(sr.elegir_a_leer(tiendas, estado, {"ultimo_completo": "2026-10-01"}, "2026-11-01", completo=True)[1], "completo")
        self.assertEqual(sr.elegir_a_leer(tiendas, estado, {}, "2026-11-01")[1], "completo")   # sin fecha de la última completa


class Freno(unittest.TestCase):
    def test_se_abre_tras_fallos_seguidos(self):
        f = sr.Cortacircuitos(maximo=3)
        f.registrar(False); f.registrar(False)
        self.assertFalse(f.abierto)
        f.registrar(False)
        self.assertTrue(f.abierto)

    def test_un_acierto_reinicia_la_cuenta(self):
        f = sr.Cortacircuitos(maximo=3)
        f.registrar(False); f.registrar(False); f.registrar(True); f.registrar(False); f.registrar(False)
        self.assertFalse(f.abierto)

    def test_un_bloqueo_de_google_lo_abre_al_instante(self):
        f = sr.Cortacircuitos(maximo=8)
        f.registrar(False, bloqueo=True)
        self.assertTrue(f.abierto)
        self.assertIn("anti-robot", f.motivo)


class CombinarParcial(unittest.TestCase):
    def test_los_no_consultados_se_quedan_como_estaban_sin_incidencia(self):
        previo = estado_de(("a", 100, 5.0), ("b", 50, 4.0))
        estado, leidos, viejos, inc = sr.combinar(previo, [{"slug": "a"}, {"slug": "b"}],
                                                  {"a": {"nombre": "A", "resenas": 120, "nota": 5.0}}, "2026-11-01")
        self.assertEqual((leidos, viejos, inc), (1, [], []))
        self.assertEqual(estado["b"], previo["b"])
        self.assertEqual(estado["a"]["resenas"], 120)


class ProcesoCompleto(unittest.TestCase):
    """Todo el flujo con la red y Google Maps simulados."""

    def _ejecutar(self, directorio, fallan=(), n=20):
        urls = [f"https://sinvelloporlaser.es/pages/tiendas/centro-{i:02d}" for i in range(n - 1)]
        urls.append("https://sinvelloporlaser.es/pages/tiendas/madrid-alcorcon")
        xml = "".join(f"<loc>{u}</loc>" for u in urls)

        def descargar(url, **kw):
            return xml if url == sr.SITEMAP_URL else '<a href="https://www.google.com/maps?cid=1">VER</a>'

        async def leer_todos(tiendas, canal, conc):
            out = {}
            for i, t in enumerate(tiendas):
                out[t["slug"]] = ({"error": "timeout"} if t["slug"] in fallan else
                                  {"nombre": f"SinVello! {t['slug']} | Láser", "resenas": 500 + i * 10, "nota": 5.0})
            return out

        with mock.patch.object(sr, "descargar", descargar), mock.patch.object(sr, "leer_todos", leer_todos):
            return sr.ejecutar(directorio=directorio)

    def test_publica_y_guarda_todo(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self._ejecutar(d), 0)
            latest = json.loads((Path(d) / "latest.json").read_text(encoding="utf-8"))
            self.assertEqual((latest["centros_leidos"], latest["centros_consultados"], latest["centros_total"]), (20, 20, 20))
            self.assertEqual(latest["modo"], "completo")
            self.assertEqual(json.loads((Path(d) / "meta.json").read_text(encoding="utf-8"))["ultimo_completo"], latest["fecha"])
            self.assertEqual(len(latest["ranking"]), 20)
            self.assertEqual(latest["ranking"][0]["slug"], "madrid-alcorcon")   # el que más reseñas tiene en la prueba
            self.assertTrue(latest["ranking"][0]["es_nuestro"])
            self.assertTrue((Path(d) / "capturas" / f"{latest['fecha']}.json").exists())
            self.assertTrue((Path(d) / "estado.json").exists())
            self.assertEqual(len((Path(d) / "log.jsonl").read_text(encoding="utf-8").splitlines()), 1)

    def test_pocos_fallos_conservan_valor_y_se_publica(self):
        with tempfile.TemporaryDirectory() as d:
            self._ejecutar(d)
            antes = json.loads((Path(d) / "latest.json").read_text(encoding="utf-8"))
            self.assertEqual(self._ejecutar(d, fallan=("centro-03",)), 0)       # 1 de 20 = 5 %
            ahora = json.loads((Path(d) / "latest.json").read_text(encoding="utf-8"))
            self.assertEqual(ahora["centros_leidos"], 19)
            self.assertEqual(ahora["centros_desactualizados"], ["centro-03"])
            self.assertEqual(len(ahora["ranking"]), len(antes["ranking"]))        # no se quita del ranking
            self.assertIn("centro-03", [r["slug"] for r in ahora["ranking"]])

    def test_el_segundo_mes_solo_lee_candidatos(self):
        leidas = []

        def montar(n):
            urls = [f"https://sinvelloporlaser.es/pages/tiendas/centro-{i:03d}" for i in range(n)]
            urls.append("https://sinvelloporlaser.es/pages/tiendas/madrid-alcorcon")
            return "".join(f"<loc>{u}</loc>" for u in urls)

        def descargar_factory(xml):
            return lambda url, **kw: xml if url == sr.SITEMAP_URL else '<a href="https://www.google.com/maps?cid=1">VER</a>'

        async def leer_todos(tiendas, canal, conc):
            leidas.append([t["slug"] for t in tiendas])
            return {t["slug"]: {"nombre": t["slug"], "resenas": 900 - int(t["slug"][-3:] or 0) if t["slug"] != "madrid-alcorcon" else 10, "nota": 5.0}
                    for t in tiendas}

        with tempfile.TemporaryDirectory() as d, mock.patch.object(sr, "leer_todos", leer_todos):
            with mock.patch.object(sr, "descargar", descargar_factory(montar(150))):
                self.assertEqual(sr.ejecutar(directorio=d, ahora=sr.datetime(2026, 10, 1, tzinfo=sr.timezone.utc)), 0)
            with mock.patch.object(sr, "descargar", descargar_factory(montar(151))):          # aparece un centro nuevo
                self.assertEqual(sr.ejecutar(directorio=d, ahora=sr.datetime(2026, 11, 1, tzinfo=sr.timezone.utc)), 0)
            latest = json.loads((Path(d) / "latest.json").read_text(encoding="utf-8"))

        self.assertEqual(len(leidas[0]), 151)                     # primera vez: todos (150 + propio)
        self.assertEqual(latest["modo"], "candidatos")
        self.assertEqual(len(leidas[1]), sr.CANDIDATOS_TOP + 2)   # 80 + propio + el centro nuevo
        self.assertIn("centro-150", leidas[1])
        self.assertEqual(latest["centros_consultados"], sr.CANDIDATOS_TOP + 2)
        self.assertEqual(latest["centros_total"], 152)
        self.assertEqual(len(latest["ranking"]), 51)              # top 50 + el propio (puesto real) al final
        self.assertEqual(latest["ranking"][-1]["slug"], "madrid-alcorcon")

    def test_demasiados_fallos_no_publican_y_mantienen_el_anterior(self):
        with tempfile.TemporaryDirectory() as d:
            self._ejecutar(d)
            antes = (Path(d) / "latest.json").read_text(encoding="utf-8")
            codigo = self._ejecutar(d, fallan=tuple(f"centro-{i:02d}" for i in range(5)))   # 5 de 20 = 25 %
            self.assertEqual(codigo, 2)
            self.assertEqual((Path(d) / "latest.json").read_text(encoding="utf-8"), antes)
            ultimo = json.loads((Path(d) / "log.jsonl").read_text(encoding="utf-8").splitlines()[-1])
            self.assertFalse(ultimo["publicado"])


if __name__ == "__main__":
    unittest.main()
