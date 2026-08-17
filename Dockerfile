FROM twentycrm/twenty:v2.27.0

# Apply the Elivate identity to the static entry experience while keeping the
# official Twenty server image and application behavior intact.
COPY --chown=node:node assets/brand/icons/ /app/packages/twenty-server/dist/front/images/icons/
COPY --chown=node:node assets/favicon.ico /tmp/brand/favicon.ico
COPY --chown=node:node scripts/apply-branding.mjs /tmp/apply-branding.mjs
RUN node /tmp/apply-branding.mjs
