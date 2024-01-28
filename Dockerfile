FROM python:3.8-slim
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir -r requirements.txt
RUN chmod +x /app/__main__.py
RUN  ./__main__.py
CMD ["sleep", "infinity"]