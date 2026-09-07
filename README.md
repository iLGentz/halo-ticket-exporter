# HALO Ticket Exporter

Estensione Manifest V3 per Chrome e Microsoft Edge (Chromium), per esportare la conversazione di un ticket HALO PSA da `https://psa.ambient7.com/` in un singolo file HTML.

## Cosa esporta

- Prima email dell'utente
- Email/messaggi successivi
- Note interne con contenuto
- Immagini presenti nei messaggi
- Autore, data/ora e tipo azione

Le azioni senza contenuto (ad esempio `Claimed`, cambi di stato o altre azioni con `.actioncontent` vuoto) vengono ignorate.

## Immagini

L'estensione prova a scaricare ogni `<img>` mentre la sessione HALO e' attiva e a convertirla in `data:` Base64. In questo modo l'HTML risultante resta normalmente autosufficiente.

Se una singola immagine non puo essere scaricata, l'esportazione continua e mantiene il suo URL HALO originale; al termine compare un avviso.

## Installazione

1. Estrai la cartella `halo-ticket-exporter`.
2. Apri Chrome oppure Microsoft Edge.
3. Vai a `chrome://extensions/` in Chrome oppure `edge://extensions/` in Edge.
4. Attiva **Modalita sviluppatore** in alto a destra.
5. Clicca **Carica estensione non pacchettizzata**.
6. Seleziona la cartella `halo-ticket-exporter` che contiene `manifest.json`.

## Uso

1. Apri un ticket su HALO.
2. Accanto al numero `[ID:XXXXXXXX]`, dentro `h1.profile-full-name`, comparira il pulsante **Esporta ticket**. Su schermi stretti puo andare a capo per restare visibile.
3. Cliccalo.
4. L'estensione prova prima a caricare tutta la cronologia tramite il contenitore infinite-scroll.
5. Legge il contenuto degli iframe `.halo-html-renderer`, incorpora le immagini e scarica `XXXXXXXX.html`.

## Se HALO cambia DOM

Se aggiorni un'installazione esistente, premi **Ricarica** nella pagina delle estensioni e ricarica anche la pagina HALO.

I selettori principali usati dalla versione 0.1.1 sono:

- Ticket: `h1.profile-full-name` contenente `[ID:...]` (non richiede un contenitore `.profile-title`)
- Cronologia: `#tickethistoryscroll .action-history-item`
- Metadati: `.history-header .when`, `.history-header .who`, `.history-header .outcome`
- Contenuto: `.history-details .actioncontent`
- HTML messaggio: `iframe.halo-html-renderer`

## Privacy

L'estensione non invia dati a servizi esterni. Lavora nel browser sulla pagina HALO e genera il file localmente.
