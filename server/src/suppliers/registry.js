import { AveoptAdapter } from './aveopt.js';
import { AveoptXmlAdapter } from './aveoptXml.js';
import { DroptAdapter } from './dropt.js';
import { LugiAdapter } from './lugi.js';
import { LugiXmlAdapter } from './lugiXml.js';
import { ZakupusAdapter } from './zakupus.js';

/**
 * Builds the list of active adapters from configuration.
 * Adding a supplier = write an adapter + register it here.
 */
export function buildAdapters({ config, logger }) {
  const adapters = [];

  if (config.suppliers.aveopt.enabled) {
    const aveopt = config.suppliers.aveopt;
    const wantsXml = aveopt.source === 'xml';
    const hasXml = Boolean(aveopt.xmlUrl || aveopt.xmlPath);

    if (wantsXml && !hasXml) {
      logger.warn('aveopt: AVEPTO_SOURCE=xml but no AVEPTO_XML_URL/AVEPTO_XML_PATH — falling back to the Store API', {});
    }

    adapters.push(
      wantsXml && hasXml
        ? new AveoptXmlAdapter({ config: aveopt, logger: logger.child({ supplier: 'aveopt' }) })
        : new AveoptAdapter({ config: aveopt, logger: logger.child({ supplier: 'aveopt' }) }),
    );
  }

  if (config.suppliers.dropt.enabled && (config.suppliers.dropt.xmlUrl || config.suppliers.dropt.xmlPath)) {
    adapters.push(
      new DroptAdapter({
        config: config.suppliers.dropt,
        logger: logger.child({ supplier: 'dropt' }),
      }),
    );
  }

  if (config.suppliers.lugi.enabled) {
    const lugi = config.suppliers.lugi;
    if (lugi.xmlUrl || lugi.xmlPath) {
      adapters.push(
        new LugiXmlAdapter({
          config: lugi,
          logger: logger.child({ supplier: 'lugi' }),
        }),
      );
    } else if (lugi.baseUrl) {
      adapters.push(
        new LugiAdapter({
          config: lugi,
          logger: logger.child({ supplier: 'lugi' }),
        }),
      );
    } else {
      logger.warn('lugi enabled but neither LUGI_XML_URL nor LUGI_API_BASE is set');
    }
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
