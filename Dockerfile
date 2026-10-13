FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts package.json ./

ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ARG APP_VERSION=dev
ENV GIT_SHA=$GIT_SHA BUILD_TIME=$BUILD_TIME APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.source="https://github.com/harsh-kumar-patwa/identity-reconciliation-service" \
      org.opencontainers.image.revision=$GIT_SHA

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
