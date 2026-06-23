FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

FROM deps AS build
COPY . .
ARG VITE_BASE=/fin-app/
RUN npm run build --workspace client -- --base "$VITE_BASE"

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY server/package.json server/package.json
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
EXPOSE 3001
CMD ["npm", "run", "start", "--workspace", "server"]
