# Stage 1: Build Python dependencies
FROM python:3.8-slim as python-builder

WORKDIR /app
COPY . .
RUN pip install --no-cache-dir -r requirements.txt
RUN chmod +x /app/__main__.py

# Stage 2: Build Node.js and Yarn dependencies
FROM node:21-alpine3.18 as node-builder

WORKDIR /app
COPY --from=python-builder /app /app
WORKDIR /app/server
RUN yarn install
RUN yarn build

# Stage 3: Final image with Python, Node.js, and Yarn
FROM python:3.8-slim

WORKDIR /app
COPY --from=python-builder /app /app

# Set NODE_ENV to production
ENV NODE_ENV production

# Explicitly copy the python dependancies from Python builder
COPY --from=python-builder /usr/local/lib/python3.8/site-packages/ /usr/local/lib/python3.8/site-packages/

# Should only need to copy the dist files but it errors?
COPY --from=node-builder /app/server/node_modules /app/server/node_modules
COPY --from=node-builder /app/server/dist /app/server/dist

# Install Node.js and npm
RUN apt-get update \
    && apt-get install -y nodejs

# Set environment variables for UID and GID
ARG PUID=1000
ARG PGID=1000

# Change ownership of the application files to the non-root user
RUN groupadd -g ${PGID} -o user
RUN useradd -m -u ${PUID} -g ${PGID} -o -s /bin/bash docker

# Switch to the non-root user
USER docker

EXPOSE 3000/tcp

WORKDIR /app/server

# Run the application
CMD ["node", "dist/main.js"]