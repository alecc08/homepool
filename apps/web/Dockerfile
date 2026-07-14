# ── Stage 1 : Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

LABEL maintainer="pooly"
LABEL description="Pooly — build stage"

WORKDIR /app

COPY package*.json ./
RUN npm ci --frozen-lockfile --cache /tmp/.npm-cache

COPY . .
RUN npm run build

# ── Stage 2 : Serve ───────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS production

# Security: non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Copy the build
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy the nginx template and the entrypoint
COPY nginx/nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Remove the default Nginx config
RUN rm -f /etc/nginx/conf.d/default.conf

# Permissions
RUN chown -R appuser:appgroup /usr/share/nginx/html && \
    chown -R appuser:appgroup /var/cache/nginx && \
    chown -R appuser:appgroup /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown appuser:appgroup /var/run/nginx.pid

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD nc -z 127.0.0.1 80 || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
