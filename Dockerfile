FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm install

FROM deps AS build
WORKDIR /app
COPY backend ./backend
RUN npm --workspace @agent-dev-center/backend run prisma:generate
RUN npm --workspace @agent-dev-center/backend run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl tini \
  && addgroup -S app \
  && adduser -S app -G app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/frontend/package.json ./frontend/package.json
RUN npm prune --omit=dev \
  && npm cache clean --force \
  && chown -R app:app /app

USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["npm", "--workspace", "@agent-dev-center/backend", "run", "start:migrate"]
