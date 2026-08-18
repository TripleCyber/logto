# syntax=docker/dockerfile:1.7

###### [STAGE] Build ######
FROM node:22-alpine AS builder
WORKDIR /etc/logto
ENV CI=true

# No need for Docker build
ENV PUPPETEER_SKIP_DOWNLOAD=true

### Install toolchain ###
RUN npm add --location=global pnpm@^10.0.0
# https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md#node-gyp-alpine
RUN apk add --no-cache python3 make g++ rsync

COPY . .

### Install dependencies and build ###
# Reuse the pnpm store between BuildKit runs to reduce duplicate downloads/writes.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm i

### Set if dev features enabled ###
ARG dev_features_enabled
ENV DEV_FEATURES_ENABLED=${dev_features_enabled}

ARG applicationinsights_connection_string
ENV APPLICATIONINSIGHTS_CONNECTION_STRING=${applicationinsights_connection_string}

ARG logto_oss_survey_endpoint=
ENV LOGTO_OSS_SURVEY_ENDPOINT=${logto_oss_survey_endpoint}

RUN pnpm -r build

### Add official connectors ###
ARG additional_connector_args
ENV ADDITIONAL_CONNECTOR_ARGS=${additional_connector_args}
RUN pnpm cli connector link $ADDITIONAL_CONNECTOR_ARGS -p .

### Prune dependencies for production ###
# Keep prune + production install in one layer to avoid extra transient disk usage.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
  rm -rf node_modules packages/**/node_modules && NODE_ENV=production pnpm i

### Clean up ###
# LOGTO PATCH(te-image-slim): fuera también `integration-tests`. Es código de
# pruebas y no tiene nada que hacer en una imagen de ejecución; son 16 MB, y lo
# que no está no se puede ejecutar por accidente.
#
# Upstream: RUN rm -rf .scripts pnpm-*.yaml packages/cloud
RUN rm -rf .scripts pnpm-*.yaml packages/cloud packages/integration-tests

# LOGTO PATCH(te-image-slim): se aparta `node_modules` del resto para poder
# copiarlos en capas distintas más abajo. Se mueve en vez de enumerar lo que
# queda: una lista escrita a mano se queda corta en cuanto upstream añada un
# fichero a la raíz, y el fallo aparecería en ejecución, no al construir.
RUN mkdir -p /salida/deps /salida/app \
  && mv node_modules /salida/deps/node_modules \
  && mv .[!.]* * /salida/app/ 2>/dev/null || true

###### [STAGE] Seal ######
FROM node:22-alpine AS app
WORKDIR /etc/logto
ARG logto_oss_survey_endpoint=
ARG private_key_rotation_grace_period=0
# Default to empty so external survey relaying stays opt-in for controlled builds/environments.
ENV LOGTO_OSS_SURVEY_ENDPOINT=${logto_oss_survey_endpoint}
ENV PRIVATE_KEY_ROTATION_GRACE_PERIOD=${private_key_rotation_grace_period}

# LOGTO PATCH(te-image-slim): la copia va en dos capas en vez de una.
#
# Medido sobre esta imagen: 1,2 GB de `node_modules` frente a 224 MB de
# `packages`, que comprimidos son 223 MB y 58 MB. Con un solo `COPY` cualquier
# cambio —una línea de SCSS en la experiencia— invalida los 281 MB enteros y hay
# que volver a subirlos. Separadas, la de dependencias solo se mueve cuando
# cambia el lockfile, y una iteración normal sube 58 MB: cinco veces y media
# menos por despliegue.
#
# El orden importa y no es casual: primero lo que casi nunca cambia.
#
# Upstream: COPY --from=builder /etc/logto .
COPY --from=builder /salida/deps/node_modules ./node_modules
COPY --from=builder /salida/app/ ./
RUN mkdir -p /etc/logto/packages/cli/alteration-scripts && chmod g+w /etc/logto/packages/cli/alteration-scripts
EXPOSE 3001

# LOGTO PATCH(te-seed-on-start): sembrar la base antes de arrancar.
#
# La imagen de upstream arranca `npm start` a secas, y contra una base vacía eso
# es un bucle de reinicio con «relation "systems" does not exist» — el esquema no
# lo crea nadie. El propio repo lo resuelve en su `docker-compose.yml`, fuera de
# la imagen; aquí se mete dentro para que la imagen sea autosuficiente y funcione
# en cualquier plataforma sin que nadie tenga que acordarse.
#
# `db seed` es idempotente: sobre una base ya sembrada informa y sale con 0, por
# eso el `&&` de upstream es correcto y no deja el contenedor sin arrancar.
#
# Upstream: ENTRYPOINT ["npm", "run"] / CMD ["start"]

# LOGTO PATCH(te-healthcheck): comprobación de salud dentro de la imagen.
#
# `/api/status` es el endpoint que el propio Logto expone para esto y responde
# 204 —un cuerpo vacío que `r.ok` da por bueno—, así que es más barato que sondear
# el descubrimiento OIDC. Se usa `node` y no `curl`/`wget` porque la base alpine no
# los trae, pero el runtime sí. El `start-period` es holgado porque el arranque
# siembra la base antes de servir.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["sh", "-c", "npm run cli db seed -- --swe && npm start"]
