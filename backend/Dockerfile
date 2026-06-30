FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN apk add --no-cache python3 make g++ openssl \
  && npm ci --no-audit --no-fund \
  && apk del python3 make g++ openssl \
  && rm -rf /root/.npm /tmp/*

FROM deps AS build
WORKDIR /app
COPY backend ./backend
RUN npm --workspace @agent-dev-center/backend run prisma:generate \
  && npm --workspace @agent-dev-center/backend run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl tini \
  && addgroup -S app \
  && adduser -S app -G app

COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=deps /app/backend/package.json ./backend/
COPY --from=deps /app/frontend/package.json ./frontend/
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
RUN npm prune --omit=dev --no-audit --no-fund \
  && chown -R app:app /app

USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["npm", "--workspace", "@agent-dev-center/backend", "run", "start:migrate"]
