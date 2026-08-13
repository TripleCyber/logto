# TripleEnable · fork de Logto

Fork de [logto-io/logto](https://github.com/logto-io/logto) con dos factores de
autenticación propios: **QR** y **Push a dispositivo**, resueltos por el IdP de
TripleEnable y su wallet (firma Ed25519).

El objetivo de este documento es que **traer cambios de upstream no duela**.

## Lee esto primero: modelo de ramas y remotes

| Rama | Qué es | Regla |
|---|---|---|
| `master` | **Espejo exacto de `logto-io/master`.** Cero código nuestro. | Solo se mueve con `merge --ff-only upstream/master`. |
| `feature/te-qr-push-factors` | `master` + nuestros commits. Es la que se despliega. | Se pone al día con `merge master`, **nunca con rebase**. |

| Remote | URL | Uso |
|---|---|---|
| `origin` | `github.com/TripleCyber/logto` | Fetch **y push**. Nuestro fork. |
| `upstream` | `github.com/logto-io/logto` | **Solo fetch.** Su URL de push está puesta a `DISABLED` a propósito. |

**Nunca pushear a `upstream`.** El código de TripleEnable no sale de este fork. Hay tres
barreras que lo impiden (sin permiso de escritura en logto-io, push URL `DISABLED`, y nada
automático abre PRs), pero la regla es explícita por si alguna cambia.

Si `upstream` no existe en un clon nuevo:

```bash
git remote add upstream https://github.com/logto-io/logto.git
git remote set-url --push upstream DISABLED
```

## Convención de marcado

Todo cambio nuestro sobre un archivo de upstream va envuelto en marcadores:

```ts
/* TE:BEGIN <feature> */
…nuestro código…
/* TE:END <feature> */
```

Buscar `TE:BEGIN` en el repo lista el 100% de la superficie del fork.

## Superficie del fork

### Archivos de upstream modificados

Mantener esta lista al día. **Si crece, algo se está haciendo mal**: preferimos
archivos nuevos antes que editar upstream.

| Archivo | Feature | Qué hace |
|---|---|---|
| `packages/experience/src/App.tsx` | `qr-push-factor` | Registra las rutas `sign-in/te-qr` y `sign-in/te-push` |
| `packages/experience/src/containers/SocialSignInList/index.tsx` | `qr-push-factor` | El botón de QR navega a su pantalla; el de push se oculta (vive en la lista de métodos) |
| `packages/experience/src/pages/SignInVerificationMethods/index.tsx` | `qr-push-factor` | Añade TripleEnable a la lista de métodos de verificación |
| `packages/experience/src/components/SwitchToVerificationMethodsLink/index.tsx` | `qr-push-factor` | Cuenta TripleEnable como opción, para que el enlace "probar otro método" aparezca |
| `packages/experience/src/components/IdentifierSignInForm/use-on-submit.ts` | `qr-push-factor` | Deriva al flujo TE cuando el identificador corresponde a una cuenta TripleEnable |
| `packages/core/src/middleware/koa-security-headers.ts` | `qr-push-factor` | Añade el origen del IdP al `connect-src` de la CSP de la experiencia (vía `TE_IDP_ORIGIN`) |
| `Dockerfile` | `qr-push-factor` | Build arg `vite_te_idp_url` + `NODE_OPTIONS` para el heap de Node (el build de la consola desborda el default) |

Total: **7 archivos de upstream, 14 nuevos**. Verificable con:

```bash
git diff --name-status master...HEAD | grep -c '^M'
```

### Archivos nuevos (no dan conflicto en merge)

Todo lo nuestro vive aislado bajo `packages/experience/src/te/`:

| Archivo | Qué es |
|---|---|
| `te/config.ts` | Targets de conector → factor, rutas, URL del IdP, timeouts |
| `te/api.ts` | Cliente del IdP TripleEnable (dispositivos + retos de firma) |
| `te/use-te-challenge.ts` | Abre el reto, espera la firma y canjea el one-time token |
| `te/use-te-push-enabled.ts` | Si el conector de push está activo en la consola |
| `te/use-te-devices.ts` | Si el identificador corresponde a una cuenta con dispositivos dados de alta |
| `te/TeLayout/` | Layout igual que `SecondaryPageLayout` pero con textos propios |
| `te/TeQrPage/` | Pantalla dedicada del QR (como la de passkey) |
| `te/TePushPage/` | Pantalla dedicada del push: selector de dispositivo + number matching |
| `te/TeMethodCard/` | Tarjeta de la lista de métodos, reutilizando los estilos nativos |
| `te/TeSwitchLink/` | Enlace "probar otro método" en las pantallas TE |

### Lo que **no** tocamos

- `packages/core` (lógica de autenticación) — intacto.
- `packages/console` (consola de admin) — intacto.
- `packages/schemas` (enums de factores, migraciones) — intacto.

Por eso los factores se modelan como **conectores**: se activan y desactivan desde la
consola nativa sin forkearla.

## Cómo funciona (resumen)

En la consola se crean dos conectores con `target` `te-qr` y `te-push`. Logto los publica
en `sign-in-exp`, y cada factor aparece donde tiene sentido según lo que necesita saber:

**QR** — no necesita saber quién eres, así que vive en la primera pantalla junto a los
botones sociales. Al pulsarlo se navega a `sign-in/te-qr`, una pantalla dedicada igual
que la de passkey, que muestra el código y espera la firma.

**Push** — necesita saber a qué dispositivos avisar, así que aparece en la lista de
métodos de verificación, una vez el usuario ha escrito su correo, usuario o teléfono.
Lleva a `sign-in/te-push`: elige dispositivo ("iPhone X") y entra en **number matching**,
donde el navegador enseña un número que hay que tocar en el teléfono.

En ambos casos el final es el mismo:

1. El wallet firma el reto con Ed25519.
2. El IdP verifica la firma y **acuña un one-time token de Logto** vía Management API.
3. La SPA canjea ese token con la Experience API nativa
   (`/verification/one-time-token/verify` → `identify` → `submit`), que es lo que crea
   la sesión.

### Number matching

El push no se aprueba a ciegas: el IdP genera un número y dos señuelos, manda los tres al
teléfono y devuelve solo el correcto al navegador. Tocar el equivocado anula el intento.
Es lo que evita que un usuario harto de notificaciones apruebe un login ajeno.

## Protocolo `te2`

`te1` firmaba un nonce opaco y entregaba el one-time token a quien conociera el
`challengeId` — que viaja dentro del QR y por un broker MQTT público. Cualquiera que
fotografiase la pantalla podía cobrar la sesión. `te2` corrige tres cosas:

**1 · Channel binding.** El navegador guarda un `verifier` aleatorio y solo publica su
SHA-256. El token se entrega a quien presente el verifier, no a quien vea el QR. Es PKCE
aplicado al reto.

**2 · Se firma un transcript, no un nonce.** El wallet firma este texto canónico y puede
enseñárselo al usuario antes de firmar:

```
te2
iss=<IdP>
rp=<origen de Logto>
client=<aplicación>
challengeId=<id>
nonce=<nonce>
verifierHash=<hash>
iat=<epoch>
exp=<epoch>
```

Orden de campos fijo y `clave=valor` por línea a propósito: el wallet está en Dart y
tiene que reconstruir exactamente los mismos bytes, sin depender de cómo ordene cada
lenguaje las claves de un JSON. La firma queda atada al dominio, la aplicación y la
caducidad, así que no sirve en ningún otro contexto.

**3 · MQTT es un timbre, no un canal de datos.** El push publica solo `{v, idp,
challengeId, deviceId}`. El material a firmar y las opciones del number matching se
recogen por TLS en `GET /te/challenge/:id/transcript`.

Lo que `te2` **no** cambia: el number matching sigue siendo necesario en el push, porque
ahí el problema es humano — el usuario no está mirando la pantalla que inició el login y
ninguna firma le dice si el intento es suyo. En el QR sí sobra: escanear ya demuestra
presencia ante esa pantalla.

Compatibilidad: los retos sin `verifierHash` siguen el camino `te1` (firma del nonce,
token por `GET`), para no romper los IdP y wallets ya desplegados.

Consecuencia: todos los factores nativos (email, SMS, TOTP, passkey), el MFA y las
políticas de Logto **siguen funcionando sin cambios**; el wallet solo añade una opción más.

## Configuración

**SPA** — dónde vive el IdP. Orden de resolución en `te/config.ts`:

1. `window.__TE_CONFIG__.idpUrl` (inyectado en tiempo de ejecución)
2. `VITE_TE_IDP_URL` (build)
3. `http://localhost:3010` (default de desarrollo)

**Core** — `TE_IDP_ORIGIN` (coma-separado) añade ese origen al `connect-src` de la CSP.
Sin esta variable el navegador bloquea las llamadas al IdP y el panel muestra
"No pudimos contactar con el IdP".

**Consola** — crear dos conectores sociales cuyo `target` sea `te-qr` y `te-push`, y
habilitarlos en el sign-in experience. A partir de ahí se encienden y apagan desde la
consola como cualquier otro conector.

## Probar en local

```bash
# 1. Postgres
docker run -d --name logto-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=p0stgr3s \
  -e POSTGRES_DB=logto -p 5459:5432 postgres:16-alpine

# 2. Logto (desde la raíz del fork)
export DB_URL="postgres://postgres:p0stgr3s@localhost:5459/logto"
export ENDPOINT="http://localhost:3001" ADMIN_ENDPOINT="http://localhost:3002"
export VITE_TE_IDP_URL="http://localhost:3010" TE_IDP_ORIGIN="http://localhost:3010"
pnpm i && pnpm -r prepack && pnpm cli db seed -- --swe && pnpm cli connector link -p .
pnpm start:dev

# 3. IdP (repo demo_idp/global-idp) en el puerto 3010, con las credenciales M2M
#    LOGTO_ENDPOINT / LOGTO_M2M_APP_ID / LOGTO_M2M_SECRET
```

Luego abrir `http://localhost:3001/demo-app`.

## Traer cambios de upstream

Dos pasos, en este orden. **`master` primero, siempre con `--ff-only`:**

```bash
git fetch upstream --prune
git checkout master
git merge --ff-only upstream/master
git push origin master
```

El `--ff-only` es la garantía del modelo: si alguna vez hubiera un commit nuestro en
`master`, el comando falla en lugar de fusionar. Si falla, es una alarma — investigar de
dónde salió ese commit, nunca forzar.

Después, integrar en nuestra rama **con merge, no rebase**:

```bash
git checkout feature/te-qr-push-factors
git merge master --no-edit
git push origin feature/te-qr-push-factors
```

Merge y no rebase porque la rama está publicada: rebasar reescribe los commits y obliga a
`--force-with-lease` en cada sincronización. La historia acumula commits de merge, que es
un coste cosmético asumido a cambio de no reescribir nada.

Los conflictos solo pueden aparecer en los 7 archivos de la tabla de arriba; los
marcadores `TE:` hacen obvio qué es nuestro.

### Verificar después de sincronizar

```bash
git diff --stat master...HEAD | tail -1        # debe coincidir con la superficie documentada
git grep -c 'TE:BEGIN' -- packages/core packages/experience
```

Si el número de archivos cambió, actualiza las tablas de este documento en el mismo commit.

**Última sincronización: 2026-08-13** — upstream `b5ddf867`, core **1.42.0**, sin
conflictos. Ojo: el salto 1.41.0 → 1.42.0 trae migraciones nuevas (`trusted_devices`,
`cimd_resource_scopes`, `cimd_user_scopes`); hay que correr las alteraciones al desplegar.

## Por qué no usamos "Bring your UI"

Logto trae un mecanismo oficial de UI propia (*custom UI assets*). **No sirve para lo que
hacemos aquí.** Está documentado para que nadie pierda tiempo intentando migrar a él:

1. **Reemplaza la UI entera, no la extiende.** `koa-spa-proxy.ts` hace
   `if (customUiAssets) return serveCustomUiAssets(...)`: o sirve la experiencia nativa, o
   sirve tu bundle — nunca las dos. Adoptarlo significa reimplementar password, código,
   social, MFA, passkey, consent y recuperación contra la Experience API. Nuestros dos
   factores se integran *dentro* del flujo nativo; es justo lo contrario.
2. **Depende de Azure Blob Storage.** `assertThat(provider === 'AzureStorage')` está
   hardcodeado en `koa-serve-custom-ui-assets.ts` y en la ruta de subida, más una Azure
   Function con blob trigger que descomprime el ZIP. El esquema admite S3 y GCS, pero el
   código de custom UI no.
3. **El `customUiCsp` configurable tampoco ayuda.** Solo se aplica cuando hay
   `customUiAssets` cargados (`koa-security-headers.ts`), y el `PATCH` que lo escribe
   exige `isCloud`.

El gate que se ve en la consola (`bringYourUiEnabled`) **no** es el bloqueo real: en OSS
el quota guard es un no-op (`quota.ts`: `if (!isCloud) return;`). El bloqueo es Azure.

### No pongas `IS_CLOUD=1`

Es tentador porque destapa el uploader en la consola, pero enciende toda la maquinaria de
Logto Cloud: resolución de suscripción contra el backend de billing, enforcement de
quotas, rutas cloud y `cloudUrlSet` para los orígenes de admin. Además el Dockerfile de
OSS hace `rm -rf packages/cloud`, así que ese código ni existe en la imagen. Rompe el
arranque.

Dónde vive el flag, por si hay que rastrearlo: `packages/shared/src/node/env/GlobalValues.ts`
(runtime del core) y `packages/console/vite.config.ts` (build de la consola).

## Trabajo pendiente conocido

**Eliminar el parche al core.** `koa-security-headers.ts` es el único archivo de
`packages/core` que tocamos, y es evitable: `connect-src` ya incluye `'self'`, así que si
el IdP de TripleEnable se sirve bajo el mismo origen que Logto (p. ej.
`https://auth.dominio.com/te-idp/*` en el reverse proxy), la CSP nativa lo permite sin
tocar nada. Eso borra las 12 líneas del core y, de paso, el build arg `VITE_TE_IDP_URL`
del Dockerfile: `teIdpUrl` pasaría a ser una ruta relativa fija.

Resultado: 0 archivos de `packages/core`, 5 de `packages/experience`, 1 Dockerfile.
