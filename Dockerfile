# Учёт ИТ-отдела — образ приложения (сервер Flask + waitress).
# База данных — отдельный контейнер PostgreSQL, см. docker-compose.yml.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# tesseract — распознавание накладных (русский и английский словари из Debian),
# iputils-ping — опрос сети в разделе «IP-адреса»,
# fonts-liberation — Liberation Serif (метрики Times New Roman): им рисуется
# PDF-наклейка «Номенк.», без шрифта в контейнере её не нарисовать.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-rus tesseract-ocr-eng iputils-ping fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# библиотеки ставятся отдельным слоем: при правке кода они не пересобираются
COPY server/requirements.txt server/requirements.txt
RUN pip install -r server/requirements.txt

COPY web/ web/
COPY server/ server/

# архив накладных: сюда монтируется папка сервера /opt/asset-it/documents
ENV DOCS_PATH=/opt/asset-it/documents \
    HOST=0.0.0.0 \
    PORT=8020
RUN mkdir -p /opt/asset-it/documents
VOLUME ["/opt/asset-it/documents"]

# приложение в контейнере слушает 8020 — тот же порт, что и снаружи по умолчанию
EXPOSE 8020
CMD ["python", "-u", "server/docker_start.py"]
