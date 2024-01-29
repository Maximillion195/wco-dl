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

# Stage 3: Final image with Python, Node.js, and Yarn
FROM python:3.8-slim
WORKDIR /app
# COPY --from=node-builder /usr/local /usr/local
COPY --from=python-builder /app /app
COPY --from=node-builder /app/server /app/server

# Install Node.js and npm
RUN apt-get update \
    && apt-get install -y nodejs \
    && apt-get install -y npm

# Install Yarn
RUN npm install -g yarn

EXPOSE 3000/tcp

WORKDIR /app/server

# Run the application
CMD ["yarn", "start:dev"]