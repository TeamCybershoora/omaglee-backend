# Use official Node.js 20 LTS Alpine image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Set default production environment variables
ENV NODE_ENV=production
ENV PORT=8000

# Copy all application files
COPY . .

# Expose default port
EXPOSE 8000

# Run the unified server
CMD ["node", "server.js"]
