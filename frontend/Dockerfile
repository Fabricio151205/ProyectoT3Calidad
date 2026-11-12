FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:stable-alpine

COPY nginx.conf /etc/nginx/nginx.conf.template
COPY --from=build /app/dist/ /usr/share/nginx/html/

USER nginx
ENV BACKEND_UPSTREAM=backend:3000
EXPOSE 8080

CMD ["sh", "-c", "envsubst '$BACKEND_UPSTREAM' < /etc/nginx/nginx.conf.template > /tmp/nginx.conf && exec nginx -c /tmp/nginx.conf -g 'daemon off;'"]
