FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server.js auth.js db.js reservations.js adminReservations.js backup.js ./

RUN mkdir -p /data && chown node:node /data
USER node

ENV NODE_ENV=production PORT=3000 DB_PATH=/data/labtrack.sqlite
EXPOSE 3000

CMD ["node", "server.js"]
