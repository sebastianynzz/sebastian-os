# OSRM autoalojado en Render (distancias viales reales para Colombia)

La API ya habla OSRM: si `OSRM_URL` está definido, el optimizador usa la malla
vial real (tabla de distancias/tiempos) y, si OSRM falla o expira, cae
automáticamente a haversine (`apps/api/src/services/routing.ts`). Lo único que
falta es el host. Esta guía lo levanta en Render con un solo contenedor.

## Qué se despliega

Un servicio Docker con dos etapas:

1. **Build**: descarga el extracto OSM de Colombia (Geofabrik, ~350 MB) y lo
   preprocesa (`osrm-extract` → `osrm-partition` → `osrm-customize`, algoritmo
   MLD). Esto pasa **una sola vez por build**, no en cada arranque.
2. **Runtime**: `osrm-routed` sirviendo `/route` y `/table` sobre el grafo ya
   procesado.

## Paso 1 — Dockerfile

Crear `infra/osrm/Dockerfile` (o usar este archivo donde prefieras):

```dockerfile
# Etapa 1: preprocesar el grafo de Colombia (perfil carro).
FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS build
ADD https://download.geofabrik.de/south-america/colombia-latest.osm.pbf /data/colombia.osm.pbf
RUN osrm-extract -p /opt/car.lua /data/colombia.osm.pbf \
 && osrm-partition /data/colombia.osrm \
 && osrm-customize /data/colombia.osrm \
 && rm /data/colombia.osm.pbf

# Etapa 2: imagen final solo con el grafo procesado.
FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY --from=build /data /data
EXPOSE 5000
# --max-table-size: la tabla NxN del optimizador (200 paradas sobra).
CMD ["osrm-routed", "--algorithm", "mld", "--max-table-size", "8000", "/data/colombia.osrm"]
```

> Perfil: `car.lua` es una aproximación razonable para motos en ciudad. Cuando
> haya tiempo, se copia un `moto.lua` ajustado (velocidades urbanas, permisos
> de vías) y se cambia el `-p`.

## Paso 2 — Servicio en Render

En `render.yaml` (o desde el dashboard → New → Web Service → Docker):

```yaml
  - type: web
    name: moveos-osrm
    runtime: docker
    dockerfilePath: ./infra/osrm/Dockerfile
    plan: standard          # ver nota de memoria abajo
    autoDeploy: false        # el grafo no cambia con cada commit
    healthCheckPath: /route/v1/driving/-74.0628,4.6486;-74.0577,4.6585
```

Notas de tamaño/costo:

- **Build**: `osrm-extract` de Colombia necesita ~3–4 GB de RAM. Los builders
  de Render lo soportan; si el build muriera por memoria, la alternativa es
  preprocesar el grafo en CI/local y subir la imagen final a un registry
  (GHCR) usando `image:` en vez de `dockerfilePath:`.
- **Runtime**: servir Colombia con MLD usa ~1.5–2 GB de RAM → plan
  **Standard (2 GB)**. El plan free (512 MB) no alcanza.
- Mejor **Private Service** si la API vive en el mismo Render: OSRM no
  necesita ser público (y evita abuso del endpoint).

## Paso 3 — Conectar la API

En el servicio `moveos-api` añadir la variable:

```
OSRM_URL=http://moveos-osrm:5000        # private service (red interna)
# o https://moveos-osrm.onrender.com    # si quedó público
```

Nada más: el optimizador detecta la variable, usa `/table/v1/driving/...` y
los planes pasan de "haversine × 1.4" a distancias y tiempos viales reales.
En los logs de la API desaparece la línea `OSRM no disponible (...): usando
haversine`.

## Verificación rápida

```bash
# Ruta Bogotá: Movistar Arena → Chapinero (lng,lat;lng,lat)
curl "https://moveos-osrm.onrender.com/route/v1/driving/-74.0628,4.6486;-74.0639,4.6416?overview=false"
# → "code":"Ok" y distance/duration reales

# Tabla (lo que usa el optimizador)
curl "https://moveos-osrm.onrender.com/table/v1/driving/-74.0628,4.6486;-74.0639,4.6416;-74.0577,4.6585?annotations=distance,duration"
```

## Mantenimiento

- El mapa de Colombia cambia poco para logística urbana: redeploy del
  servicio OSRM cada 3–6 meses trae el extracto fresco de Geofabrik.
- Si la operación crece a otra región (México/Chile/Perú), un servicio OSRM
  por país con su extracto, y `OSRM_URL` por tenant/región en la fase
  multi-región.
