# OSRM autoalojado con el extracto OSM de Colombia (ver docs/OSRM_RENDER.md).
#
# Etapa 1: descarga el extracto de Geofabrik (~350 MB) y preprocesa el grafo
# (MLD). Corre UNA vez por build — el arranque del servicio es inmediato.
# Memoria de build: osrm-extract necesita ~3-4 GB (los builders de Render
# lo soportan; si fallara, preprocesar en local y publicar la imagen a GHCR).
FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS build
ADD https://download.geofabrik.de/south-america/colombia-latest.osm.pbf /data/colombia.osm.pbf
RUN osrm-extract -p /opt/car.lua /data/colombia.osm.pbf \
 && osrm-partition /data/colombia.osrm \
 && osrm-customize /data/colombia.osrm \
 && rm /data/colombia.osm.pbf

# Etapa 2: imagen final solo con el grafo procesado (~1.5-2 GB de RAM en
# runtime → plan Standard de Render; el free de 512 MB no alcanza).
FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY --from=build /data /data
EXPOSE 5000
# Perfil car.lua: aproximación razonable para motos urbanas. Cuando haya un
# moto.lua ajustado (velocidades/permisos de vía), se cambia el -p de arriba.
# --max-table-size acota la tabla NxN del optimizador (200 paradas sobra).
CMD ["osrm-routed", "--algorithm", "mld", "--max-table-size", "8000", "/data/colombia.osrm"]
