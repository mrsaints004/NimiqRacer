FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV DB_PATH=/app/data/nimiq-racer.sqlite

# Mount a persistent volume here on whatever platform you deploy to (Fly.io volumes, Railway
# volumes, Render disks, a bind mount on a VPS, ...) — without it, the SQLite file resets to
# empty every time the container restarts or redeploys.
VOLUME ["/app/data"]

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8787/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/index.js"]
