FROM node:20-slim

WORKDIR /app

# Install dependencies
RUN npm init -y && \
    npm install @xeokit/xeokit-convert@1.3.1 web-ifc@0.0.57

# Copy worker script
COPY worker.mjs .

# Health check — worker is a long-running process
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD pgrep -f "node worker.mjs" || exit 1

ENV NODE_OPTIONS="--max-old-space-size=6144"

CMD ["node", "worker.mjs"]
