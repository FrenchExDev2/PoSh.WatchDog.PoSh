# FrenchExDev.PoSh.WatchDog.PoSh — besoin d’une extension VS Code

Date : **28 octobre 2026**. Statut : **expression du besoin et exigences proposées**.

Le produit attendu est une **extension VS Code Desktop**, utilisable avec VS Code Stable et Insiders, distribuée sous forme de **VSIX**. Son rôle est de surveiller la mémoire du processus PowerShell Editor Services associé à la fenêtre courante et de déclencher une action avant qu’il ne sature la machine.

Le nom `FrenchExDev.PoSh.WatchDog.PoSh` désigne ici le projet. L’extension fonctionne dans l’hôte d’extensions Node.js de VS Code ; un éventuel composant PowerShell sert à la collecte système. Ce document décrit le produit à développer. Aucune fonctionnalité ni validation de l’extension n’est acquise à ce stade.

## 1. Problème observé

Pendant une séance de développement, l’utilisateur a constaté environ **58 Go de RAM occupée** sur un poste équipé de 64 Go. Les relevés effectués pendant l’échange du 28 octobre 2026 ont identifié un processus PowerShell particulièrement volumineux.

| Observation | Valeur relevée |
|---|---|
| Mémoire physique visible par Windows | 63,75 Gio |
| Mémoire physique utilisée, premier relevé | 62,59 Gio |
| Mémoire physique disponible | Environ 1,16 à 1,27 Gio selon le relevé |
| Processus principal | `pwsh.exe`, PID `12724` |
| Mémoire physique résidente du processus | 36,08 Gio, puis 42,18 Gio sur un autre relevé |
| Mémoire privée allouée au processus | Environ 60,33 Gio |
| Identification | PowerShell Editor Services, lancé par VS Code Insiders |
| Extension PowerShell identifiée | `ms-vscode.powershell`, version `2026.1.2` |
| Date de création du processus | 28 octobre 2026 à 17 h 06, heure de Paris |
| Autre consommateur identifié | `vmmemWSL`, environ 7,32 Gio de mémoire résidente |

**Provenance :** mesures locales de la séance de diagnostic, à partir de `Get-CimInstance Win32_OperatingSystem`, `Get-Process` et de l’identification du processus par sa ligne de commande et son parent. Ces valeurs sont des instantanés historiques ; elles ne décrivent pas l’état actuel du poste. Les deux relevés de mémoire résidente ne constituent pas une mesure régulière de la croissance.

Le diagnostic établit qu’une session PowerShell Editor Services occupait une part majeure de la RAM. Il n’établit pas la cause de cette occupation : fuite mémoire, objets conservés, profil, module chargé, analyse de sources ou autre activité restent des pistes à examiner. Aucune cause particulière ne doit être présentée comme démontrée.

La mémoire résidente et la mémoire privée allouée décrivent des aspects différents du même processus. Elles ne doivent pas être additionnées. Les définitions sont précisées dans les références Microsoft de la section 11.

## 2. Besoin utilisateur

> En tant qu’utilisateur de PowerShell dans VS Code, je veux que l’éditeur surveille la mémoire de sa session PowerShell Editor Services, m’avertisse en cas de dépassement et puisse la redémarrer selon une politique configurable, afin de préserver la réactivité du poste sans surveiller manuellement le Gestionnaire des tâches.

Le résultat attendu est une protection préventive. Identifier et corriger la cause d’une consommation excessive reste un travail distinct, auquel les mesures du watchdog peuvent contribuer.

Dans la version `2026.1.2` inspectée localement, le manifeste de l’extension PowerShell ne déclare pas de paramètre de limite mémoire ou de watchdog. Il expose en revanche la commande `PowerShell.RestartSession`. Cette observation est bornée à cette version ; la compatibilité devra être vérifiée lors du développement.

## 3. Périmètre de la première version

La première version vise **Windows et PowerShell 7 Core**, dans une fenêtre locale de VS Code Desktop. Elle doit prendre en charge Stable et Insiders, avec une qualification explicite des versions effectivement testées.

La surveillance porte sur le processus **PowerShell Editor Services de la fenêtre concernée**. Les consoles PowerShell ordinaires, les autres fenêtres VS Code, les commandes de build, les processus Node.js et la machine virtuelle WSL/Podman conservent leur propre cycle de vie.

Les sessions distantes SSH, WSL, Dev Containers, Codespaces et VS Code dans le navigateur sont hors du périmètre initial. L’extension doit afficher un état explicite lorsque la cible ou l’environnement ne sont pas pris en charge.

La livraison attendue comprend le code de l’extension, son manifeste, un VSIX installable, les instructions d’utilisation, les limites connues et les résultats de qualification. Le présent livrable couvre uniquement l’expression du besoin.

## 4. Politique de surveillance proposée

Les valeurs suivantes sont des **choix initiaux proposés pour ce poste de 64 Go**, à ajuster après mesure. Elles ne correspondent pas à des seuils imposés par Microsoft.

| Paramètre | Proposition initiale | Comportement attendu |
|---|---:|---|
| Intervalle de mesure | 15 secondes | Une seule collecte à la fois |
| Seuil d’avertissement | 4 Gio | Notification et état visible, sans répétition à chaque mesure |
| Seuil de redémarrage | 8 Gio | Évaluation de la politique de redémarrage |
| Persistance du dépassement | 3 mesures consécutives | Trois relevés valides au-dessus ou au niveau du seuil, espacés normalement de 15 secondes |
| Délai maximal d’une collecte | 3 secondes | Un échec est signalé comme une mesure inconnue |
| Délai maximal d’un redémarrage | 45 secondes | Au-delà, échec visible et suspension des tentatives automatiques |
| Temporisation après redémarrage | 120 secondes | Stabilisation de la nouvelle session avant une nouvelle action automatique |
| Limite des redémarrages automatiques | 3 sur une heure glissante | Suspension de l’automatisme et notification à l’utilisateur |

La métrique principale est la **mémoire privée allouée/engagée du processus**, en octets, correspondant à `PrivateMemorySize64` sous Windows. La mémoire résidente est affichée séparément pour expliquer l’effet sur la RAM physique. Une pagination importante ne doit pas faire disparaître un dépassement de la métrique principale.

Un Gio vaut `1 073 741 824` octets. Les seuils, les données collectées et l’interface doivent utiliser des unités cohérentes et explicites.

Le mode proposé est `automatic`, avec un mode `notifyOnly` pour les utilisateurs qui souhaitent conserver la décision de redémarrer. Le comportement choisi doit être visible dans l’interface. Un redémarrage réinitialise les variables, les modules et l’état de la session et peut interrompre une commande en cours.

## 5. Exigences fonctionnelles

### 5.1 Identifier la bonne session

- Associer sans ambiguïté la fenêtre VS Code, la session PowerShell Editor Services, son PID et sa date de création.
- Utiliser un mécanisme d’association de session vérifié lors du prototype : API disponible, identifiant de session ou artefact de démarrage propre à cette fenêtre.
- Ne pas sélectionner une cible sur le seul nom `pwsh.exe`. Le parent VS Code ou la présence de `Start-EditorServices` permettent un diagnostic, mais ne garantissent pas à eux seuls l’association à une fenêtre précise.
- Si l’association est ambiguë, afficher cet état et ne déclencher aucune action sur un processus.
- Réidentifier la cible après chaque remplacement de session. Un PID réutilisé par Windows ne doit pas hériter des compteurs de l’ancienne cible.
- Traiter l’absence d’une session PowerShell démarrée comme un état normal d’attente.

### 5.2 Collecter et afficher les mesures

- Collecter hors de la session PowerShell surveillée, de façon asynchrone, avec un délai maximal et sans mesures concurrentes.
- Afficher au minimum la mémoire privée, la mémoire résidente, l’identité de session, l’âge du dernier relevé valide et l’état du watchdog.
- Représenter une erreur, un accès refusé ou une expiration par une valeur inconnue et un diagnostic bref. Ne jamais les convertir en une consommation nulle.
- Conserver un historique borné pour comprendre les dépassements, avec date, métriques, seuils applicables et décisions.
- Réinitialiser la série de dépassements après une mesure sous le seuil, un changement de cible, une erreur de collecte ou une modification de politique. Un long intervalle sans mesure valide ne compte pas comme un dépassement continu.

### 5.3 Avertir et redémarrer

- Signaler un premier dépassement du seuil d’avertissement, puis éviter les notifications répétitives tant que l’état n’a pas changé.
- En mode automatique, demander le redémarrage seulement lorsque les trois dépassements consécutifs sont établis et que les conditions de temporisation et de quota sont satisfaites.
- Utiliser la commande de l’extension PowerShell de la fenêtre courante, après vérification de sa disponibilité :

  ```typescript
  await vscode.commands.executeCommand('PowerShell.RestartSession');
  ```

- Considérer cette commande comme une dépendance de compatibilité à vérifier, et son retour comme une demande traitée, non comme la preuve que la nouvelle session fonctionne.
- Vérifier ensuite que l’ancienne identité de processus a été remplacée, que la nouvelle cible est correctement associée et qu’une nouvelle mesure est disponible. Publier le résultat réel : réussi, échoué, expiré ou indéterminé.
- En cas d’échec ou de redémarrage sans amélioration durable, conserver le diagnostic et suspendre l’automatisme selon les règles prévues. Éviter les boucles de redémarrage.

### 5.4 Respecter les activités et les choix de l’utilisateur

- Reporter les redémarrages automatiques pendant un débogage PowerShell actif, puis refaire une mesure avant toute décision après sa fin.
- Ne pas assimiler l’absence de débogage à une console interactive inactive. La possibilité de détecter de manière fiable une commande PowerShell en cours doit être qualifiée ; elle n’est pas supposée acquise.
- Expliquer cette limite du mode automatique. Une commande interactive peut être interrompue par un redémarrage même lorsqu’aucun débogage n’est actif.
- Fournir les actions : activer/désactiver la surveillance, suspendre pour une durée donnée, reprendre, changer de mode, redémarrer manuellement et consulter le diagnostic.
- Préserver une décision de désactivation lors d’un simple rechargement de fenêtre.

## 6. Architecture attendue

Le watchdog s’exécute dans l’**hôte d’extensions Node.js**, indépendamment de la session PowerShell observée. Il ne doit pas dépendre d’un timer, d’un job ou d’une commande exécutée à l’intérieur du PowerShell qui risque de saturer.

Pour le périmètre local Windows, l’emplacement d’exécution doit être déclaré et vérifié, par exemple avec `extensionKind: ["ui"]`. La documentation VS Code distingue les hôtes locaux et distants ; l’emplacement du watchdog ne prouve pas l’emplacement de la session PowerShell.

Les responsabilités à séparer sont : association de session, collecte système, évaluation des seuils, orchestration du redémarrage et interface. Le choix du backend de collecte reste à prototyper. Un éventuel auxiliaire PowerShell doit être borné, utiliser PowerShell Core sans charger le profil utilisateur et fonctionner indépendamment de la cible surveillée.

Les seuls noms et chemins de processus suffisent à produire des informations de diagnostic, mais pas à autoriser une action en présence de plusieurs sessions. La résolution de cette association est une condition d’acceptation du prototype.

Le watchdog partage l’hôte d’extensions avec d’autres extensions : il reste actif si la session PowerShell se bloque, sous réserve que cet hôte reste lui-même fonctionnel. Il ne remplace pas une supervision externe de VS Code entier.

## 7. Configuration et interface proposées

Le bloc suivant est une **proposition de futur contrat de configuration**. Ces paramètres ne sont pas encore fournis par une extension installable.

```json
{
  "frenchexdev.powershellWatchdog.enabled": true,
  "frenchexdev.powershellWatchdog.mode": "automatic",
  "frenchexdev.powershellWatchdog.sampleIntervalSeconds": 15,
  "frenchexdev.powershellWatchdog.warningPrivateGiB": 4,
  "frenchexdev.powershellWatchdog.restartPrivateGiB": 8,
  "frenchexdev.powershellWatchdog.consecutiveSamples": 3,
  "frenchexdev.powershellWatchdog.collectTimeoutSeconds": 3,
  "frenchexdev.powershellWatchdog.restartTimeoutSeconds": 45,
  "frenchexdev.powershellWatchdog.cooldownSeconds": 120,
  "frenchexdev.powershellWatchdog.maxAutomaticRestartsPerHour": 3,
  "frenchexdev.powershellWatchdog.deferWhileDebugging": true
}
```

Les valeurs doivent être validées : nombres positifs, compteurs entiers, seuil d’avertissement strictement inférieur au seuil de redémarrage. Une politique invalide suspend les actions automatiques et affiche une explication.

Les paramètres permettant des actions automatiques sur les processus doivent relever des paramètres utilisateur de la machine. Un dépôt ouvert ne doit pas pouvoir augmenter cette autorisation par ses seuls fichiers `.vscode/settings.json`.

La barre d’état doit distinguer : attente de session, surveillance normale, avertissement, dépassement confirmé, action différée, redémarrage, stabilisation, suspension et erreur. Les notifications donnent une action concrète, notamment consulter les mesures ou suspendre le watchdog.

## 8. Contraintes de fonctionnement

- Aucun arrêt global de `pwsh.exe`, de VS Code, de WSL ou de Podman.
- Aucun arrêt forcé automatique dans la première version. Si le redémarrage demandé n’aboutit pas, le diagnostic reste visible et une intervention manuelle est proposée.
- Aucun besoin de droits administrateur pour le fonctionnement courant ; un accès insuffisant est signalé sans élévation automatique.
- Aucun lancement de session PowerShell Editor Services uniquement pour pouvoir la surveiller.
- Pas de modification du profil PowerShell, du runtime .NET installé ou des fichiers de l’extension Microsoft.
- Collecte limitée aux données nécessaires. Les lignes de commande complètes, variables d’environnement, secrets et contenus des scripts ne sont pas enregistrés dans les journaux du produit.
- Historique plafonné à 200 mesures ; journal avec rotation, plafond proposé de 3 fichiers de 5 Mio. Ces budgets doivent être documentés et vérifiés.
- Objectif initial : surcoût mémoire stabilisé inférieur à 50 Mio dans un scénario d’attente représentatif, sans historique croissant. Cette cible est à mesurer ; la mémoire totale de l’hôte partagé ne peut pas être attribuée directement au seul watchdog.
- Aucun blocage synchrone prolongé de l’hôte d’extensions. Les erreurs du collecteur et du redémarrage sont isolées du traitement de l’interface.

## 9. Critères d’acceptation

La qualification doit utiliser des scénarios reproductibles et des mesures simulées pour les dépassements importants. Il n’est pas nécessaire de saturer une machine à plusieurs dizaines de Gio pour vérifier la politique.

| ID | Situation | Résultat attendu |
|---|---|---|
| AC-01 | Une session PowerShell locale est active | La bonne session, son PID et sa date de création sont identifiés et mesurés |
| AC-02 | Deux fenêtres VS Code ont chacune leur session | Chaque watchdog agit uniquement sur la session de sa fenêtre |
| AC-03 | L’association à une fenêtre est ambiguë | Aucune action sur un processus ; diagnostic visible |
| AC-04 | Le seuil d’avertissement est franchi | Une notification et un état d’avertissement sont affichés sans répétition à chaque collecte |
| AC-05 | Une seule mesure dépasse 8 Gio, puis redescend | Aucun redémarrage automatique ; compteur remis à zéro |
| AC-06 | Trois mesures valides consécutives atteignent ou dépassent 8 Gio | Une demande unique de redémarrage, en mode automatique et hors différé/temporisation/quota |
| AC-07 | Un relevé échoue entre deux dépassements | Valeur inconnue signalée et série de dépassements interrompue |
| AC-08 | Un débogage PowerShell est actif | Redémarrage différé ; nouvelle mesure après sa fin avant décision |
| AC-09 | L’ancienne session est remplacée ou son PID est réutilisé | La cible est réidentifiée ; les compteurs de l’ancienne identité sont abandonnés |
| AC-10 | La commande de redémarrage retourne normalement mais aucune nouvelle session n’est mesurable | Aucun succès inventé ; résultat indéterminé, échoué ou expiré selon les preuves disponibles |
| AC-11 | Le quota de trois redémarrages sur une heure est atteint | L’automatisme est suspendu et la raison est affichée |
| AC-12 | La session PowerShell ne répond plus | La collecte et l’interface du watchdog continuent hors de cette session ; toute action reste bornée |
| AC-13 | Le watchdog est désactivé ou en mode `notifyOnly` | Aucun redémarrage automatique |
| AC-14 | L’environnement est distant ou non pris en charge | État explicite ; aucune action sur un processus local choisi par approximation |
| AC-15 | La surveillance tourne durablement sans dépassement | Collectes sans chevauchement, historique et journaux bornés, surcoût mesuré |
| AC-16 | Le VSIX est installé sur les versions Stable et Insiders retenues | Activation, configuration, affichage, désactivation et redémarrage sont vérifiés ; les versions sont consignées |

Les résultats devront distinguer les tests de politique sur données simulées, l’intégration avec VS Code et l’extension PowerShell, puis les mesures de consommation du watchdog lui-même.

## 10. Points à qualifier avant implémentation complète

1. **Association fiable entre fenêtre et processus.** Vérifier les informations réellement exposées par l’extension PowerShell et les artefacts de session disponibles ; ne pas inventer une API de PID.
2. **Collecte indépendante.** Choisir le backend Windows et mesurer son coût, ses délais et le comportement en cas d’accès refusé.
3. **Activité de session.** Établir les signaux fiables pour le débogage et les commandes interactives, avec les limites documentées.
4. **Redémarrage et récupération.** Vérifier la présence et le comportement de `PowerShell.RestartSession`, puis la possibilité de constater une nouvelle session. Éprouver le cas où la commande reste bloquée.
5. **Compatibilité.** Consigner les versions de Windows, VS Code, PowerShell et de l’extension Microsoft qualifiées ; traiter les versions non reconnues explicitement.

Ces points sont des travaux de conception et de validation, pas des fonctions déjà démontrées par le présent document.

## 11. Références et niveau de preuve

- **Incident du 28 octobre 2026 :** relevés locaux consignés dans la section 1. Ils établissent la consommation de la session identifiée, sans démontrer sa cause.
- **Paramètres et commande PowerShell :** inspection locale du manifeste de `ms-vscode.powershell-2026.1.2`. Le [manifeste public du projet PowerShell](https://github.com/PowerShell/vscode-powershell/blob/main/package.json) permet de retrouver les commandes et paramètres déclarés ; sa branche principale peut évoluer.
- **Exécution de commandes entre extensions :** [API VS Code — Commands](https://code.visualstudio.com/api/extension-guides/command). L’API permet l’appel d’une commande ; son existence ne garantit pas à elle seule le résultat du redémarrage.
- **Emplacement et cycle de vie d’une extension :** [VS Code — Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host). Cette référence fonde le choix d’un watchdog dans l’hôte d’extensions et la distinction entre environnement local et distant.
- **Mémoire privée du processus :** [Microsoft — Process.PrivateMemorySize64](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.privatememorysize64).
- **Mémoire physique résidente :** [Microsoft — Process.WorkingSet64](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.workingset64).

Les seuils, budgets, noms de paramètres et critères d’acceptation du présent document sont des propositions de conception. Leur validation devra produire des résultats séparés de l’expression initiale du besoin.

Le code doit être écrit en anglais et respecter les standards en vigueur.
Tester le package dans un vscode-insiders bac à sable avec plusieurs powershell qui vont saturer la mémoire.
