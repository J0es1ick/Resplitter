FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY web ./web
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=43127 \
    OCR_FALLBACK_ENABLED=false
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY scripts/backup.cjs ./scripts/backup.cjs
RUN mkdir -p /app/data/tmp && chown -R node:node /app
USER node
EXPOSE 43127
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:43127/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/src/index.js"]
