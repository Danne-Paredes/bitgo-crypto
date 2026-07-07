# ── Stage: base Node image ──────────────────────────────────────────────────
# node:20-alpine = Node 20 on a minimal Linux (Alpine). Small and fast.
FROM node:20-alpine

# Set the working directory INSIDE the container.
# All subsequent commands run from here. Nothing outside this path is touched.
WORKDIR /app

# Copy only the dependency manifests first.
# Docker caches this layer — if package.json hasn't changed, it skips npm install on rebuilds.
COPY package.json package-lock.json ./

# Install dependencies inside the container (not on your host machine).
RUN npm ci

# Copy the rest of the project files into the container.
COPY . .

# Vite's dev server listens on 5173 by default. Expose it so Docker can map it.
EXPOSE 5173

# The command that runs when the container starts.
# --host 0.0.0.0 makes Vite accessible from outside the container (your browser).
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
