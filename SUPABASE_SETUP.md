# MCCLL: Record-System mit Supabase – Einrichtung

Das neue System:

1. Spieler **erstellen einen Account** (Username, E-Mail, Passwort).
2. Spieler **reichen Records ein** (`Submit Record`).
3. Spieler **verwalten ihren Account** (Username, Nation, Passwort, Status ihrer Records).
4. Reviewer/Admins sehen alle Einreichungen unter **Staff** und klicken
   **Accept** / **Reject** – ein akzeptierter Record steht **sofort** auf der Liste
   und zählt im Leaderboard. Kein JSON-Bearbeiten mehr nötig.

Solange `js/config.js` leer ist, läuft die Seite exakt wie vorher (Liste + Leaderboard aus `data/`).
Packs, Tournaments, Accounts und Staff erscheinen erst, wenn Supabase eingerichtet ist.

**Wichtig:** Die MCCLL braucht ein **eigenes** Supabase-Projekt (nicht das der PCL),
sonst landen Accounts, Levels und Records beider Listen in derselben Datenbank.

---

## 1. Supabase-Projekt anlegen (einmalig, ~10 Minuten)

1. Auf <https://supabase.com> einloggen → **New project** (Free Plan reicht).
   Region z. B. *Central EU (Frankfurt)*. Datenbank-Passwort irgendwo sicher speichern.
2. Links **SQL Editor** → **New query** → kompletten Inhalt von
   [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**.
   Es muss „Success. No rows returned" erscheinen.
3. **Project Settings → API** öffnen und in [`js/config.js`](js/config.js) eintragen:
   - `SUPABASE_URL` = *Project URL* (z. B. `https://abcd1234.supabase.co`)
   - `SUPABASE_ANON_KEY` = *anon public* Key

   Der anon-Key ist absichtlich öffentlich. **Niemals** den `service_role`-Key eintragen.

## 2. Login-Einstellungen (Authentication)

**Authentication → URL Configuration**

- **Site URL**: die Haupt-Adresse, z. B. `https://mccll.pages.dev`
- **Redirect URLs** → *Add URL* (alle Seiten, von denen sich Leute einloggen):
  - `https://mccll.pages.dev/**`
  - `https://*.mccll.pages.dev/**` (deckt `dev.mccll.pages.dev` und alle Preview-Links ab)
  - eure eigene Domain, falls vorhanden

  (`mccll` jeweils durch euren echten Projektnamen ersetzen.)

**Authentication → Providers → Email**

- **Confirm email**: Wichtig! Supabase verschickt mit dem eingebauten Mailserver nur
  **sehr wenige Mails pro Stunde** (aktuell ca. 2). Bei vielen Anmeldungen gleichzeitig
  bleiben Bestätigungsmails dann hängen. Zwei Möglichkeiten:
  - **Einfach:** *Confirm email* ausschalten → Account ist sofort nutzbar.
    Nachteil: Man kann sich mit fremder E-Mail anmelden; „Passwort vergessen" funktioniert
    dann nur, wenn die E-Mail stimmt.
  - **Sauber:** eigenen SMTP-Dienst eintragen (*Project Settings → Authentication → SMTP*,
    z. B. Resend oder Brevo, beide haben Gratis-Kontingente) und *Confirm email* anlassen.

## 3. Dich selbst zum Admin machen

1. Auf der Website mit deinem Namen registrieren.
2. Supabase → **SQL Editor** (nur dieses eine Mal nötig):

   ```sql
   update public.profiles set role = 'admin' where username = 'DeinName';
   ```

3. Seite neu laden → in der Navigation erscheint **Staff**.

Alle weiteren Rollen vergibst du danach direkt auf der Website:
**Staff → Users & roles** → bei der Person *User*, *Reviewer* oder *Admin* auswählen.

- **Reviewer** dürfen Records akzeptieren/ablehnen und Manual entries anlegen.
- **Admins** zusätzlich Rollen vergeben, Einreichungen endgültig löschen und
  unpassende Banner/Bios entfernen.
- Die eigene Rolle kann man nicht ändern (damit sich niemand aus Versehen aussperrt).

## Update auf eine neue Version

Wenn sich `supabase/schema.sql` geändert hat (z. B. für neue Features):
die **komplette Datei erneut im SQL Editor ausführen**. Bestehende Accounts und Records
bleiben dabei erhalten.

## 4. Alle Levels in die Datenbank übernehmen (einmalig)

Danach werden **alle** Levels und Records über die Website verwaltet; `data/*.json`
wird nicht mehr benutzt (bleibt als Backup im Repo).

1. `supabase/schema.sql` im SQL Editor ausführen (wie bei jedem Update).
2. `supabase/import_json_levels.sql` im SQL Editor ausführen.
   Importiert alle Levels aus `data/_list.json` in der aktuellen Reihenfolge (inkl. „Percent to
   qualify" und Passwort) und alle 150 Records aus den JSON-Dateien (als akzeptierte Records
   unter dem Spielernamen, mit Prozent und Hz).
   Mehrfach ausführen schadet nicht – Vorhandenes wird übersprungen. Levels, die schon
   über die Website hinzugefügt wurden, behalten ihre Platzierung.
3. Seite neu laden. Unter **Staff → Levels** stehen jetzt alle Levels.

Wer noch Änderungen an den JSON-Dateien gemacht hat, bevor importiert wird:
`python3 scripts/build_import_sql.py` erzeugt das Import-SQL neu.

**Gefunden beim Import (bitte prüfen):** `MCCLL` steht in `data/_list.json` zweimal
(#42 und #51). In der Datenbank gibt es das Level nur einmal (auf dem oberen Platz), dadurch
rutscht alles darunter um einen Platz nach oben.

## 5. Was wo passiert

| Was | Wo |
|---|---|
| Levels + Reihenfolge | Supabase-Tabelle `levels` (`placement` = Rang), verwaltet unter **Staff → Levels** |
| Records | Supabase-Tabelle `submissions` (Status `pending` / `accepted` / `rejected`) |
| Öffentliche Liste der akzeptierten Records | Supabase-View `records` |
| Packs | Supabase-Tabelle `packs`, verwaltet unter **Staff → Packs** |
| Tournaments | Supabase-Tabelle `tournaments`, verwaltet unter **Staff → Tournaments** |
| Accounts | Supabase *Authentication* + Tabelle `profiles` (Username, Nation, Rolle, Profil) |
| List Editors | weiterhin `data/_editors.json` |

Solange der Import (Schritt 4) noch nicht gelaufen ist, liest die Seite die Levels weiter
aus `data/*.json` und mischt Website-Levels und neue Records hinein.

### Profile, CBF, Demon Faces

- Jeder Name (Records, Leaderboard, Creator/Verifier) verlinkt auf eine Profilseite
  `/#/player/<Name>`. Spieler mit Account können dort Banner (Farbe oder Bildlink), Bio
  und bis zu 3 **gepinnte Records** anzeigen (einstellbar auf der Account-Seite).
- **CBF** (Click Between Frames) ist beim Einreichen ankreuzbar; Hz ist dann optional.
  In den JSON-Dateien geht dasselbe mit `"cbf": true` oder `"hz": "CBF"`.
- **Demon Faces:** kommen aus `"rating"` (`rate`, `featured`, `epic`, `legendary`, `mythic`)
  und `"difficulty"` (`easy` … `extreme`) der Level-JSON bzw. aus dem Level-Formular.
  Fehlt eins davon, steht dort **N/A**.
- **Leaderboard:** rechts erscheint ein kompaktes Profil (Banner, Nation, Stats, gepinnte
  Records); **Full profile →** öffnet die komplette Profilseite.

### Levels verwalten (Admins)

**Staff → Levels**: Level-ID, Platzierung, Name, Publisher, Verifier, Creators,
Verification-Video, optional Showcase/Passwort, **Percent to qualify**, Rating + Difficulty (oder N/A).

- Platzierung = Rang. Ein Level auf #5 setzen schiebt alles dazwischen um eins –
  beim Hinzufügen, Verschieben (Edit → Placement) und Entfernen.
- Die Suche oben im Tab findet Levels nach Name, ID oder Rang.

### Packs (Admins)

**Staff → Packs**: Name (max. 32 Zeichen), Farbe, **Punkte**, Reihenfolge, Beschreibung
und bis zu 50 Levels. Als Punkte-Vorschlag zeigt das Formular 10 % der Punkte der Levels.

- Wer alle Levels eines Packs geschafft hat (completed oder verified), bekommt die
  Bonuspunkte im Leaderboard dazu und das Pack als Abzeichen im Profil.
- Die Seite **Packs** zeigt Name, Punkte und Levels. Eingeloggte Spieler sehen, welche
  Levels sie schon haben und „✓ Completed · +X points earned".

### Geometry-Dash-Account

Auf der Account-Seite kann jeder seinen GD-Namen eintragen (z. B. `TeamLostLife`).
Damit niemand fremde Punkte übernimmt, zählt die Verknüpfung erst, wenn ein Admin sie
unter **Staff → Users & roles** mit **Confirm** bestätigt (Filter „GD accounts to confirm").
Danach gehören alles, was unter dem GD-Namen auf der Liste steht – Verifications,
Records und Creator/Publisher-Credits („Created" im Profil) – zum Account, und
`/#/player/<GD-Name>` leitet auf das Profil weiter. Wer den GD-Namen ändert, braucht
eine neue Bestätigung.

### Records, Progress und Legacy

- **#1 – #75**: Records ab dem „Percent to qualify" des Levels (Progress-Records zählen
  mit weniger Punkten, wie bisher).
- **#76 – #150**: nur 100 %.
- Punkte gibt es nur für die Top 100 (wie bisher).
- **ab #151 = Legacy**: In der Liste steht eine „Legacy"-Trennlinie, die Levels tauchen im
  Einreichformular nicht auf und nehmen keine neuen Records an.

Das prüft auch die Datenbank. Spieler können auf einem Level, auf dem sie schon einen
Record haben, nur einen **besseren** Prozentwert einreichen (z. B. erst 60 %, später 100 %);
auf der Liste steht immer der beste. Staff kann über **Manual entry** weiterhin alles
nachtragen.

### Tournaments

**Staff → Tournaments** (alle Staff-Mitglieder, also Reviewer und Admins): Turnier anlegen mit
**Name**, **Datum + Uhrzeit** (in der eigenen Ortszeit eingeben), **Größe** (Spielerzahl) und
**Region** (World, North America, South America, Europe, Africa, Asia, Oceania). Optional:
Gewinner (nach dem Turnier eintragen) und ein Link (Bracket/Stream). Bearbeiten und Löschen
geht in der Liste darunter.

Die Seite **Tournaments** zeigt:

- ganz oben den **World Tournament Countdown** bis zum nächsten Turnier mit Region „World",
- eine **Weltkarte**: Kontinente mit anstehenden Turnieren sind hervorgehoben, die Zahl am
  Kontinent = Anzahl anstehender Turniere,
- Klick auf einen Kontinent → anstehende Turniere dort + **Historie** (vergangene Turniere
  mit Gewinner). Ohne Auswahl stehen alle anstehenden Turniere darunter.

Alle Zeiten werden jedem Besucher in seiner eigenen Zeitzone angezeigt.

### Level-Suche

Über der Liste gibt es ein Suchfeld (Name, Level-ID, Creator, Verifier oder „#12").
Die Ränge bleiben dabei die echten Ränge.

### Records ohne Account

Einzelne Records ohne Account trägt Staff unter **Staff → + Manual entry** ein.

## 6. Sicherheit (kurz)

Alle Regeln liegen in der Datenbank (Row Level Security in `supabase/schema.sql`),
nicht im JavaScript – man kann sie also nicht über die Browser-Konsole umgehen:

- Jeder kann Profile (Username, Nation) und akzeptierte Records lesen.
- Kommentare, Raw-Footage-Links und Review-Notizen sehen nur der Einreicher und Staff.
- Spieler können nur eigene Records einreichen, immer als `pending`, und nur eigene
  offene Einreichungen zurückziehen.
- Niemand kann sich selbst eine Rolle geben – nur Admins oder das SQL-Dashboard.
- Supabase zeigt beim View `records` evtl. eine Warnung „Security Definer View" an.
  Das ist hier gewollt: Die View gibt nur akzeptierte Records und nur öffentliche
  Spalten heraus.
