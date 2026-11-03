import { AveoptAdapter } from './aveopt.js';
import { LugiAdapter } from './lugi.js';
import { ZakupusAdapter } from './zakupus.js';

/**
 * Builds the list of active adapters from configuration.
 * Adding a supplier = write an adapter + register it here.
 */
export function buildAdapters({ config, logger }) {
  const adapters = [];

  if (config.suppliers.aveopt.enabled) {
    adapters.push(
      new AveoptAdapter({
        config: config.suppliers.aveopt,
        logger: logger.child({ supplier: 'aveopt' }),
      }),
    );
  }

  if (config.suppliers.lugi.enabled && config.suppliers.lugi.baseUrl) {
    adapters.push(
      new LugiAdapter({
        config: config.suppliers.lugi,
        logger: logger.child({ supplier: 'lugi' }),
      }),
    );
  }

  if (config.suppliers.zakupus.enabled && (config.suppliers.zakupus.xmlUrl || config.suppliers.zakupus.xmlPath)) {
    adapters.push(
      new ZakupusAdapter({
        config: config.suppliers.zakupus,
        logger: logger.child({ supplier: 'zakupus' }),
      }),
    );
  }

  return adapters;
}

export function adapterMap(adapters) {
  return new Map(adapters.map((adapter) => [adapter.id, adapter]));
}
