FROM nginx:1.27-alpine

COPY index.html /usr/share/nginx/html/index.html
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/
COPY assets/    /usr/share/nginx/html/assets/
COPY vendor/    /usr/share/nginx/html/vendor/

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
