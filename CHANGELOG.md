# [1.9.0](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/compare/v1.8.0...v1.9.0) (2026-11-19)


### Features

* **hml:** permite testes privados do ALB por túnel SSM ([dbef18e](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/dbef18e8ebeff4ec2201639ffc95df8bffb75262))

# [1.8.0](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/compare/v1.7.1...v1.8.0) (2026-11-19)


### Features

* **observabilidade:** registra X-Azion-Request-Id nos logs de falha HTTP ([72623d5](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/72623d505403580b92fb1f3205f5bab6b08f2f6a))

## [1.7.1](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/compare/v1.7.0...v1.7.1) (2026-11-19)


### Bug Fixes

* **makefile:** aprimora diagnostico de borda e corrige validacao de modo compare ([9b24d77](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/9b24d7723d6cbd3c0dcf3e0c9a7f83f2b7d1f952))

# [1.7.0](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/compare/v1.6.0...v1.7.0) (2026-11-19)


### Features

* **hml:** integra testes e observabilidade à topologia atual ([18248be](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/18248bec55bf961c9675ddcff321ecb68a32b722))

# [1.6.0](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/compare/v1.5.0...v1.6.0) (2026-11-16)


### Features

* **k6:** descreve os cenários nos relatórios de execução ([7644386](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/764438628ac627a518bc84bdcc238800e93fb960))
* **telemetria:** amplia o monitoramento de homologação em tempo real ([4ea75ca](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/4ea75cac465b16e57b2bd463a632968d152d9df8))

# [1.5.0](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/compare/v1.4.0...v1.5.0) (2026-11-13)


### Features

* **k6:** aprimora a validação de homologação pela Azion e pelo balanceador ([76bea0d](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/76bea0dd0ba674fe2c4f3e3c5a5e9a1b0062c2cd))

# [1.4.0](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/compare/v1.3.0...v1.4.0) (2026-11-13)


### Features

* **telemetria:** adiciona coleta do balanceador de testes em HML ([d6d495b](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/d6d495b63ab206bca2221e35f2c565ce0744d0e6))

# [1.3.0](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/compare/v1.2.0...v1.3.0) (2026-11-12)


### Features

* **diagnostico:** implementa reproducao completa do 504 com comparativo 4-vias e trava de sessao ([ada4c58](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/ada4c5816b0b75f5a923359c294634ccf3964af3))
* **telemetria:** implementa observabilidade completa de HML com SSM, modo live watch e sonda sincrona ([6caff5b](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/6caff5b210988575cb84fe82dae7bd37d3907c05))

# [1.3.0](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/compare/v1.2.0...v1.3.0) (2026-11-12)


### Features

* **telemetria:** adiciona observabilidade completa de HML com CloudWatch, RDS e SSM EC2

# [1.2.0](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/compare/v1.1.0...v1.2.0) (2026-11-12)


### Features

* **relatorios:** traduz nomes de cenarios checks e relatorios para pt-br ([8ed7a01](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/8ed7a01b6268465153033b8e08477f9e05bdd259))

# [1.1.0](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/compare/v1.0.0...v1.1.0) (2026-11-12)


### Features

* **diagnostico:** adapta suite hml para comparativo azion vs ec2 e trava fanbase ([f10c812](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/f10c81234b97529c964b8f9f550f5b55109e2292))

# 1.0.0 (2026-11-11)


### Features

* **arquitetura:** implementa suite k6 hexagonal hml com ci e cobertura 100 por cento ([6de07aa](https://github.com/victorhc-silveira-ilegra/palmeiras-k6-test/commit/6de07aa2d1fa288ee3d82c56ad028a2e97aea644))
