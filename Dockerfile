FROM node:20-slim

WORKDIR /app

# Install dependencies first so this layer is cached unless package*.json changes.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source.
COPY . .

ENV NODE_ENV=production
EXPOSE 5000

# The app is run directly from TypeScript via tsx (see package.json "start"):
# tsconfig.json only emits declaration files, so there's no compiled JS to run.
CMD ["npm", "start"]
