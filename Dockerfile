# Build stage for Node dependencies
FROM node:21-alpine AS node-builder

WORKDIR /app/server

# Copy package files
COPY server/package*.json server/yarn.lock ./

# Install dependencies with yarn (project uses yarn.lock)
RUN yarn install --frozen-lockfile

# Copy source code
COPY server/ ./

# Build the application
RUN yarn build

# Final stage
FROM python:3.12-slim

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -m appuser

# Install Node.js
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_21.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python source
COPY *.py ./

# Make main script executable
RUN chmod +x __main__.py

# Copy Node.js build
COPY --from=node-builder /app/server/package*.json ./server/
COPY --from=node-builder /app/server/dist ./server/dist
COPY --from=node-builder /app/server/node_modules ./server/node_modules
COPY --from=node-builder /app/server/client ./server/client

# Create data directories
RUN mkdir -p /data/downloads /app/config && \
    chown -R appuser:appuser /data/downloads /app/config /app

# Set working directory to server
WORKDIR /app/server

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api || exit 1

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "dist/main.js"]
