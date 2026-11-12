import { describe, expect, it } from 'vitest';
import {
  DomainInvariantError,
  ForbiddenProductionTargetError,
} from '../../../src/domain/errors/DomainError.ts';
import { loadSettings } from '../../../src/infrastructure/config/Settings.ts';

describe('loadSettings', () => {
  it('carrega valores padrao seguros para HML quando __ENV esta vazio', () => {
    const settings = loadSettings({});
    expect(settings.environment.name).toBe('hml_classic_elb');
    expect(settings.scaleFactor).toBe(1);
    expect(settings.rampUp).toBe('20s');
    expect(settings.hold).toBe('40s');
    expect(settings.rampDown).toBe('15s');
    expect(settings.soakVus).toBe(2);
    expect(settings.soakDuration).toBe('2m');
    expect(settings.logLevel).toBe('INFO');
    expect(settings.logErrors).toBe(true);
    expect(settings.logErrorSampleRate).toBe(1);
    expect(settings.scenarioName).toBe('run');
    expect(settings.allowFanbaseLoad).toBe(false);
    expect(settings.wpAuthCookie).toBe('');
    expect(settings.wpNonce).toBe('');
    expect(settings.wpAjaxAction).toBe('heartbeat');
    expect(settings.wpAdminPath).toBe('/wp-admin/');
  });

  it('aplica overrides validos de ambiente', () => {
    const settings = loadSettings({
      TARGET_ENV: 'hml_ec2_direct',
      TARGET_URL: 'http://172.31.35.15:80/',
      REQUEST_TIMEOUT: '320s',
      ALLOW_FANBASE_LOAD: 'true',
      WP_AUTH_COOKIE: 'wordpress_logged_in=abc',
      WP_NONCE: 'nonce123',
      WP_AJAX_ACTION: 'custom_heavy_action',
      WP_ADMIN_PATH: '/wp-admin/plugins.php',
      SCALE_FACTOR: '0.4',
      RAMP_UP: '5s',
      HOLD: '15s',
      RAMP_DOWN: '5s',
      SOAK_VUS: '2',
      SOAK_DURATION: '5m',
      LOG_LEVEL: 'DEBUG',
      LOG_ERRORS: 'false',
      LOG_ERROR_SAMPLE_RATE: '0.5',
      SCENARIO_NAME: 'fanbase_simul',
    });

    expect(settings.environment.name).toBe('hml_ec2_direct');
    expect(settings.environment.baseUrl).toBe('http://172.31.35.15:80');
    expect(settings.environment.timeout).toBe('320s');
    expect(settings.allowFanbaseLoad).toBe(true);
    expect(settings.wpAuthCookie).toBe('wordpress_logged_in=abc');
    expect(settings.wpNonce).toBe('nonce123');
    expect(settings.wpAjaxAction).toBe('custom_heavy_action');
    expect(settings.wpAdminPath).toBe('/wp-admin/plugins.php');
    expect(settings.scaleFactor).toBe(0.4);
    expect(settings.rampUp).toBe('5s');
    expect(settings.hold).toBe('15s');
    expect(settings.rampDown).toBe('5s');
    expect(settings.soakVus).toBe(2);
    expect(settings.soakDuration).toBe('5m');
    expect(settings.logLevel).toBe('DEBUG');
    expect(settings.logErrors).toBe(false);
    expect(settings.logErrorSampleRate).toBe(0.5);
    expect(settings.scenarioName).toBe('fanbase_simul');
  });

  it('aborta ao receber TARGET_ENV de producao ou parametros numericos invalidos', () => {
    expect(() => loadSettings({ TARGET_ENV: 'prod_alb' })).toThrow(ForbiddenProductionTargetError);
    expect(() =>
      loadSettings({ TARGET_ENV: 'hml_ec2_direct', TARGET_URL: 'https://www.palmeiras.com.br' })
    ).toThrow(ForbiddenProductionTargetError);
    expect(() =>
      loadSettings({ TARGET_ENV: 'hml_ec2_direct', TARGET_URL: 'ftp://52.202.111.170' })
    ).toThrow(DomainInvariantError);
    expect(() => loadSettings({ WP_ADMIN_PATH: '/prod-admin/' })).toThrow(
      ForbiddenProductionTargetError
    );
    expect(() => loadSettings({ SCALE_FACTOR: '0' })).toThrow(DomainInvariantError);
    expect(() => loadSettings({ SOAK_VUS: '-2' })).toThrow(DomainInvariantError);
    expect(() => loadSettings({ LOG_ERROR_SAMPLE_RATE: '1.5' })).toThrow(DomainInvariantError);
    expect(() => loadSettings({ LOG_LEVEL: 'TRACE' })).toThrow(DomainInvariantError);
  });
});
