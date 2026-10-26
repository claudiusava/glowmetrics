# Ranking mensual de reseñas de Google (franquicia SinVello!)

Obtiene una vez al mes el número total de reseñas y la nota de Google de los
centros de la franquicia y deja guardado el **top 50 por número total de
reseñas**. Solo reseñas totales: sin ganancias ni comparativas. La pantalla de
la app que lo muestre se hará aparte; esto es solo obtención y almacenamiento.

## Cómo se ejecuta

```bash
pip install -r ranking/requirements.txt
python -m playwright install chromium               # una vez (en el servidor)

python ranking/sinvello_ranking.py                  # captura real (candidatos; completa si toca)
python ranking/sinvello_ranking.py --completo       # fuerza leer TODOS los centros
python ranking/sinvello_ranking.py --canal msedge   # en Windows, usando el Edge instalado
python ranking/sinvello_ranking.py --limite 12      # prueba rápida con 12 centros (escribe en data/_prueba)
python -m unittest discover -s ranking -v           # pruebas (no usan red)
```

**Programación:** GitHub Action `.github/workflows/ranking-mensual.yml`, el
**día 1 de cada mes a las 06:00 UTC**. Instala Chromium, lanza el proceso y
guarda los datos en `ranking/data/` con un commit. También se puede lanzar a
mano (pestaña Actions > Run workflow; casilla "completo" para leer todos los
centros). Si falla, GitHub envía un aviso por correo.

## Qué hace (y cómo evita que Google bloquee)

1. Lee `https://sinvelloporlaser.es/sitemap_metaobject_pages_1.xml` y se queda con
   las fichas `/pages/tiendas/<slug>` (los centros nuevos entran solos).
2. En cada ficha busca el enlace a Google Maps (`maps?cid=…`; si no, el enlace largo `maps/place/…`).
3. **Solo pide a Google lo necesario:**
   - **Captura completa** (todos los centros, ~200): la primera vez, cada 6 meses y con `--completo`.
   - **Captura de candidatos** (~82 centros): los 80 primeros de la última captura,
     `madrid-alcorcon` y los centros nuevos. El resto conserva su último valor
     (están lejos del top 50). Son unas 80 consultas al mes en vez de ~800 al mes.
4. Lee con calma: **2 pestañas a la vez**, pausa aleatoria de 1–3,5 s antes de cada
   centro, 2 reintentos y 45 s de límite. **Rechaza siempre las cookies de Google.**
5. **Freno de emergencia:** si Google muestra su verificación anti-robot, o fallan
   8 centros seguidos, deja de consultar para no empeorar el bloqueo.
6. Si un centro falla, **conserva su último valor bueno** y lo anota en el log; no sale del ranking.
7. Si falla **más del 10 %** de los centros consultados, **no publica** el ranking
   nuevo: mantiene el anterior, anota el motivo en el log y termina con error (código 2).
8. Ordena por reseñas (desempate: nota y nombre), guarda el top 50 y añade
   `madrid-alcorcon` al final con su puesto real si queda fuera.

## Qué se guarda (`ranking/data/`)

| Archivo | Contenido |
|---|---|
| `latest.json` | Última captura publicada (la que usará la app) |
| `capturas/AAAA-MM-DD.json` | Cada captura con su fecha |
| `estado.json` | Último valor bueno de cada centro (para conservarlo si falla o no se consulta) |
| `meta.json` | Fecha de la última captura completa |
| `log.jsonl` | Una línea por ejecución: modo, leídos/consultados, publicado o no, incidencias |

Formato de `latest.json`:

```json
{
  "fecha": "2026-10-26",
  "capturado_en": "2026-10-26T15:40:17+00:00",
  "modo": "completo",
  "centros_leidos": 202,
  "centros_consultados": 204,
  "centros_total": 204,
  "publicado": true,
  "centros_desactualizados": [],
  "ranking": [
    { "puesto": 1, "nombre": "Málaga - Teatinos", "slug": "malaga-teatinos", "reseñas": 2025, "nota": 4.9, "es_nuestro": false }
  ],
  "incidencias": [ { "slug": "…", "motivo": "…", "accion": "…" } ]
}
```

`es_nuestro` es `true` solo para `madrid-alcorcon`. `modo` es `completo` o `candidatos`.

## Archivos

- `sinvello_ranking.py` — el proceso completo (sitemap → fichas → lectura → ranking → guardado).
- `maps_reader.py` — **el único archivo que toca Google Maps** (`leer_google_maps`).
- `test_sinvello_ranking.py` — pruebas del parseo, el orden, la elección de candidatos, el freno y la regla del 10 %.

## Aviso importante

Leer las páginas de Google Maps va contra sus condiciones de uso y se rompe si
Google cambia los textos (`aria-label`) de la página; además, desde los
servidores de GitHub Google puede mostrar verificaciones anti-robot. Por eso la
lectura está aislada en `maps_reader.py`: para pasar a la **Google Places API**
(campos `rating` y `userRatingCount`) basta con reescribir `leer_google_maps`
para que devuelva lo mismo (`nombre`, `resenas`, `nota`). La regla del 10 % y el
freno de emergencia evitan publicar un ranking roto o seguir llamando a Google
si algo cambia.
