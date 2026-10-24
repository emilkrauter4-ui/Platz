# Versand-Checkliste: Go / No-Go

**Ausrichtung:** Meinungsumfrage von einem Gründer, kein Verkauf, kein Pilot-Angebot (Texte in `mails/`; die Verkaufstexte liegen zurückgestellt in `mails/spaeter_verkauf/`). Das senkt das Risiko, beseitigt es aber nicht: Gerichte können auch Umfrage-Mails als Werbung werten, wenn dahinter erkennbar Kundengewinnung steht.

Stand: Alles, was ich vorbereiten konnte, ist fertig. Offen ist, was nur du tun kannst. **Erst wenn alle Punkte unter „Muss“ abgehakt sind, werden Mails verschickt.**

## 1. Muss: Rechtliches (vor der ersten Mail)

- [ ] **Unternehmen vorhanden?** Wer Angebote an Firmen schickt, handelt gewerblich: Gewerbeanmeldung (Einzelunternehmen genügt) bzw. Firma. Absenderangaben in Mail und Impressum müssen stimmen.
- [ ] **Kaltmail-Risiko verstanden.** Nach § 7 Abs. 2 Nr. 3 UWG ist Werbung per E-Mail ohne vorherige ausdrückliche Einwilligung unzulässig – **das gilt nach herrschender Meinung auch gegenüber Unternehmen**. Eine Ausnahme für Bestandskunden (§ 7 Abs. 3) greift hier nicht. Die Folge ist im Regelfall eine Abmahnung mit Anwaltskosten und Unterlassungserklärung, in der Praxis oft mehrere hundert bis über tausend Euro. Mach vor dem Versand **eine Stunde Beratung bei einem Anwalt für Wettbewerbsrecht (IT-Recht)** und lass dir diese Frage beantworten: *„Darf ich Hersteller und Händler mit einer einmaligen Bitte um eine Branchen-Einschätzung für meine Gründer-Pitches per E-Mail anschreiben (kein Angebot, keine Werbung), und was muss in der Mail stehen?“* Das ist das Geld wert.
- [ ] **Sicherere Reihenfolge der Kanäle** (siehe `mails/03_andere_kanaele.md`):
  1. Kontaktformular auf der Firmen-Website (Firma entscheidet selbst, keine personenbezogene Adresse nötig)
  2. LinkedIn-Kontaktanfrage und Nachricht
  3. Telefonische Erstansprache B2B: bei mutmaßlichem Interesse nach § 7 Abs. 2 Nr. 2 UWG eher vertretbar, aber nicht frei von Risiko
  4. E-Mail nur nach Anwaltsrat, und dann an die allgemeine Firmenadresse oder an die öffentlich im Impressum genannte Person
- [ ] **Datenschutz-Information (Art. 14 DSGVO)** steht im Fuß jeder Mail: Quelle der Adresse, Hinweis „Antwort genügt zum Löschen“. Eine ausführliche Datenschutzerklärung liegt unter `landing/datenschutz.html`.
- [ ] **Löschroutine:** Wer absagt oder sich abmeldet, bekommt keine weitere Mail. In `tracker.csv` Spalte „Löschen bis“ pflegen und nach Ablauf wirklich löschen.
- [ ] **Signatur der Mail** mit Name, Anschrift und Kontakt (ist in den Texten vorgesehen). Eine Landingseite mit Impressum brauchst du nur, wenn du später eine veröffentlichst.
- [ ] **Nutzungsbedingungen / Haftungshinweis:** „Orientierung, keine Genehmigung“ steht sichtbar in Demo, Video und Landingseite (ist umgesetzt). Für einen echten Pilot braucht es zusätzlich einen kurzen Vertrag (Haftungsbegrenzung, Datenschutz). Das kommt nach dem ersten Gespräch.
- [ ] **Fachprüfung der Regeln** durch Bauamt oder Architekt vor jedem Pilot mit echten Kunden (nicht nötig für die Vorführung mit fiktivem Grundstück, aber im Gespräch ehrlich sagen, dass sie noch aussteht).

## 2. Muss: Technik

- [ ] **Eigene Domain** (nicht gmail.com): z. B. `deinname.de` oder ein Projektname. Mailadresse darauf einrichten.
- [ ] **SPF, DKIM, DMARC** für die Domain gesetzt (bei Google Workspace, Microsoft 365, IONOS, Strato jeweils eine Anleitung). Test: mail-tester.com, Ziel 9/10 oder besser.
- [ ] **Video hochgeladen** (YouTube „Nicht gelistet“), Link auf Handy **und** Laptop geprüft, ohne Anmeldung abspielbar.
- [ ] **Konfiguration geprüft:** In den Texten unter `vertrieb/ausgabe/mails/` steht keine `{{...}}` mehr. Alles in `[eckigen Klammern]` füllst du pro Empfänger.

## 3. Versandregeln

- Reintext, kein Logo, **kein Tracking-Pixel**, keine Anhänge in der Erstmail (Links statt PDF; Spam-Filter und Datenschutz).
- **Eine Person je Mail**, nie mehrere Empfänger im Verteiler.
- **20 bis 30 Mails pro Tag**, wochentags zwischen 8 und 10 Uhr oder 13 und 15 Uhr. Die ersten Tage nur 10 bis 15 (Aufwärmen der neuen Domain).
- Jede Mail einzeln anpassen: Firmenname und ein konkreter Bezug (ein Modell aus dem Sortiment, der Standort). Das erhöht die Antwortquote und senkt das Spam-Risiko.
- Zeitplan je Kontakt: Tag 0 Anfrage, Tag 7 eine kurze Erinnerung, dann Schluss.
- **Wahrheit:** Pitch-Wettbewerbe nur nennen, wenn du dich beworben hast oder angemeldet bist. Nach einem Gespräch **keine Verkaufsmail** an dieselbe Adresse, außer die Person hat ausdrücklich zugestimmt.
- Antworten innerhalb von 4 Stunden, bei „Ja“ am selben Tag.

## 4. Messen (damit du nach 3 Wochen entscheiden kannst)

| Kennzahl | Wert |
|---|---|
| Kontaktiert | ___ von 150 |
| Antworten (egal ob Ja oder Nein) | ___ (Ziel mindestens 5) |
| Gespräche | ___ (Ziel mindestens 2) |
| Konkreter Pilot-Kandidat | ___ (Ziel mindestens 1) |
| Demo geöffnet (nur wenn ihr serverseitig zählt; ohne Tracking nur grob über Hoster-Statistik) | ___ |

**Entscheidungsregel vorab:** Wenn nach 150 Kontakten und 3 Wellen kein einziges Gespräch entstanden ist, liegt es entweder an der Ansprache (Betreffzeile, Kanal) oder am Thema. Dann erst 10 Telefonate führen („Wie viele Kunden fragen nach Genehmigung?“), bevor du weiter in Produkt oder Mail investierst.

## 5. Abbruch sofort, wenn

- eine Abmahnung kommt: nicht selbst antworten, Anwalt einschalten, Versand stoppen
- jemand um Löschung bittet: umgehend löschen und bestätigen
- Mails im Spam landen (mail-tester-Wert fällt, Rückläufer über 5 %): pausieren, Domain/Text prüfen
