FROM grafana/k6:latest

WORKDIR /app

COPY --chown=k6:k6 data ./data
COPY --chown=k6:k6 src ./src
COPY --chown=k6:k6 .env.example ./.env.example

ENV TARGET_ENV=azion_edge

USER k6

ENTRYPOINT ["k6"]
CMD ["run", "src/presentation/scenarios/smoke.ts"]
