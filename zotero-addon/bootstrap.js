/* Uses Zotero's documented bootstrap and server endpoint contracts. */
var zheReaderBridge;
async function startup({ rootURI }) {
  const scope = {};
  Services.scriptloader.loadSubScript(rootURI + "annotations.js", scope);
  Services.scriptloader.loadSubScript(rootURI + "bridge.js", scope);
  zheReaderBridge = new scope.ZheReaderZoteroBridge({
    Zotero,
    Services,
    IOUtils,
    protocol: scope,
  });
  zheReaderBridge.start();
}
function shutdown() {
  zheReaderBridge?.stop();
  zheReaderBridge = null;
}
function install() {}
function uninstall() {}
