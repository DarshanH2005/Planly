FROM python:3.14-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLANLY_DATA_DIR=/var/lib/planly

COPY pyproject.toml ./
COPY learning ./learning
RUN pip install --no-cache-dir .

RUN useradd --create-home --uid 10001 planly && mkdir -p /var/lib/planly && chown -R planly:planly /app /var/lib/planly
USER planly

EXPOSE 8000
CMD ["uvicorn", "learning.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
