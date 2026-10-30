# Local Chat sous Windows

Un chat IA qui tourne **sur ta carte graphique**, sans compte, sans cloud. Tes conversations restent sur ton PC.

Prévu pour une carte NVIDIA avec 16 Go de VRAM (RTX 4080 / 4080 Super).

## Installer

1. Installe **Ollama** : <https://ollama.com/download/windows> (ou `winget install Ollama.Ollama` dans un terminal).
2. Télécharge `Local Chat Setup x.y.z.exe` depuis la page **Releases** du dépôt et lance-le.
3. Windows affiche « Windows a protégé votre PC » (l'installeur n'est pas signé) :
   clique **Informations complémentaires**, puis **Exécuter quand même**.

## Premier lancement

La fenêtre « Models » s'ouvre toute seule (aussi quand le modèle choisi n'est pas encore téléchargé). Elle affiche ta carte graphique (détectée avec `nvidia-smi`) et marque chaque modèle « fits in GPU » ou « spills to RAM » selon sa mémoire vidéo. Clique **Download** sur un modèle, attends la barre de progression, puis **Use**.

| Modèle | Poids | Remarque |
|---|---|---|
| Qwen3.5 9B Coder | 5,8 Go | Choix par défaut, tient largement en VRAM |
| Qwen3.5 4B | 2,7 Go | Le plus léger |
| Qwen3.8 27B (Q3) | 13,2 Go | Tient en 16 Go, mais juste (le contexte prend de la place) |
| Qwen3 Coder 30B, Gemma 4 26B | 17-19 Go | Dépassent la VRAM : une partie va en RAM, c'est plus lent |

Le bandeau « Running on GPU 100% » (en haut) confirme que le modèle est bien dans la carte graphique.

## Mises à jour

L'appli vérifie les nouvelles versions au démarrage et les installe à la fermeture.

## Un souci ?

Réglages (roue dentée) → **Copy diagnostic**, puis colle le texte dans ton message. Il contient les versions, l'usage de la VRAM
et les dernières lignes du log, jamais tes conversations. Le log complet est dans `%APPDATA%\Local Chat\logs\server.log`.

- *« The chat server did not start »* : un autre programme utilise le port 43117.
- *Le modèle est lent* : regarde « Running on … » ; en dessous de 100 % GPU, choisis un modèle plus petit.

## Désinstaller

Paramètres Windows → Applications → Local Chat. Les conversations sont dans le profil de l'appli (`%APPDATA%\Local Chat`) ; supprime ce dossier pour les effacer.

## Pour le mainteneur : publier une version

```bash
git tag v0.1.0 && git push origin v0.1.0
```

La CI (`.github/workflows/release.yml`) construit l'installeur sur Windows et l'attache à la Release GitHub.
Le dépôt doit être public pour que les mises à jour automatiques marchent sans jeton.
Test en local (Linux/Mac, sans installeur) : `cd chat && npm run electron:dev`.
