# Official Python image only: no third-party base image.
FROM python:3.12.8-slim-bookworm@sha256:2199a62885a12290dc9c5be3ca0681d367576ab7bf037da120e564723292a2f0

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb xauth tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.lock .
RUN pip install --require-hashes -r requirements.lock

# Google Chrome stable (the scraper launches channel="chrome" in containers) plus its OS libraries.
RUN patchright install --with-deps chrome \
 && rm -rf /var/lib/apt/lists/*

COPY contact_scraper ./contact_scraper
COPY server.py ./

RUN useradd --create-home --uid 10001 scraper && chown -R scraper:scraper /app
USER scraper

EXPOSE 8000
ENTRYPOINT ["tini", "--"]
CMD ["python", "server.py"]
