# iVideo Share

Web app en `Next.js + TypeScript` para analizar una URL publica de Instagram, mostrar metadata util antes de descargar y entregar la mejor variante de video disponible.

## Incluye

- `POST /api/analyze` para validar y resolver metadata publica
- `GET /api/download` para proxyear la descarga desde el servidor
- UI responsive con formulario, preview y historial local
- pruebas unitarias del resolver

## MVP

- soporta `reels` y `posts` publicos con video
- prioriza la mejor calidad disponible
- muestra formato, resolucion, duracion y peso estimado
- no soporta login, privado ni compresion

## Desarrollo

```bash
pnpm install
pnpm dev
```

## Verificacion

```bash
pnpm test
pnpm build
```
