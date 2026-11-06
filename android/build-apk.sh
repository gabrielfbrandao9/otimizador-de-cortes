#!/usr/bin/env bash
# Gera o APK deste site (sem Gradle): copia o site e as bibliotecas externas para dentro do
# app, compila, empacota e assina. Resultado: dist/<NOME_APK>.apk
#
# Uso (no Git Bash, na pasta do projeto):  bash android/build-apk.sh
#
# Precisa do Android SDK (build-tools 34 e platform 34) e do JDK 17 em
# ANDROID_SDK (padrão: C:\Users\Gabriel\android-sdk). A chave de assinatura fica em
# ANDROID_CHAVES (padrão: Documents\Claude Code\apk-chaves), fora do Git.
# Ao publicar uma versão nova, aumente os números em android/versao.txt.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
AND="$RAIZ/android"
SDK="${ANDROID_SDK:-/c/Users/Gabriel/android-sdk}"
CHAVES="${ANDROID_CHAVES:-/c/Users/Gabriel/Documents/Claude Code/apk-chaves}"
BT="$SDK/build-tools/34.0.0"
PLAT="$SDK/platforms/android-34/android.jar"
JDK="$(ls -d "$SDK"/jdk-17* 2>/dev/null | head -1)"
[ -n "$JDK" ] || { echo "JDK 17 não encontrado em $SDK"; exit 1; }
JAVA="$JDK/bin/java"
JAVAC="$JDK/bin/javac"
KEYTOOL="$JDK/bin/keytool"

conf() { tr -d '\r' < "$AND/app.conf" | sed -n "s/^$1=//p"; }
APP_ID="$(conf APP_ID)"
NOME_APK="$(conf NOME_APK)"
REPO="$(conf REPO)"
read -r VCODE VNAME < <(tr -d '\r' < "$AND/versao.txt")

OUT="$AND/build"
DIST="$RAIZ/dist"
APK="$DIST/$NOME_APK.apk"

rm -rf "$OUT"
mkdir -p "$OUT/assets/www" "$OUT/assets/app" "$OUT/assets/cdn" "$OUT/classes" "$DIST"

echo "1/6 Copiando o site e as bibliotecas para dentro do app"
(
  cd "$RAIZ"
  git ls-files | grep -vE '^(android|supabase|exemplos)/|^(README|SUPABASE)\.md$|^sw\.js$|^\.' | while IFS= read -r f; do
    mkdir -p "$OUT/assets/www/$(dirname "$f")"
    cp "$f" "$OUT/assets/www/$f"
  done
)
cp "$AND/shim.js" "$OUT/assets/app/shim.js"
cat > "$OUT/assets/app/config.properties" <<EOF
site=https://gabrielfbrandao9.github.io/$REPO
repo=gabrielfbrandao9/$REPO
apk=$NOME_APK.apk
EOF
# Bibliotecas de endereço fixo que o site usa: vão no APK para abrir sem internet
(cd "$OUT/assets/www" && grep -rhoE "https://(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)/[^'\"\` )]+" . || true) | sort -u | while IFS= read -r url; do
  nome="$(printf %s "$url" | sha1sum | cut -d' ' -f1)"
  curl -fsSL --retry 3 --max-time 120 -o "$OUT/assets/cdn/$nome" "$url"
  echo "    $url"
done

echo "2/6 Recursos (ícones, tema)"
sed "s/__APP_ID__/$APP_ID/g" "$AND/AndroidManifest.xml" > "$OUT/AndroidManifest.xml"
"$BT/aapt2" compile --dir "$AND/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$PLAT" --manifest "$OUT/AndroidManifest.xml" \
  "$OUT/res.zip" --auto-add-overlay \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "$VCODE" --version-name "$VNAME"

echo "3/6 Compilando o Java"
mapfile -t FONTES < <(find "$AND/src" -name '*.java')
"$JAVAC" -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$PLAT" -classpath "$BT/core-lambda-stubs.jar" -d "$OUT/classes" "${FONTES[@]}"

echo "4/6 Convertendo para Android (dex)"
mapfile -t CLASSES < <(find "$OUT/classes" -name '*.class')
"$JAVA" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release --min-api 24 --lib "$PLAT" --output "$OUT" "${CLASSES[@]}"
# Arquivos do site entram aqui (e não pelo aapt2 -A, que no Windows grava os
# caminhos com "\" e o Android não acha os arquivos)
(cd "$OUT" && mapfile -t ASSETS < <(find assets -type f) && "$BT/aapt" add base.apk classes.dex "${ASSETS[@]}" >/dev/null)
if "$BT/aapt" list "$OUT/base.apk" | grep -q '\\'; then echo "Erro: caminho com \\ dentro do APK"; exit 1; fi

echo "5/6 Alinhando"
"$BT/zipalign" -f -p 4 "$OUT/base.apk" "$OUT/alinhado.apk"

echo "6/6 Assinando"
mkdir -p "$CHAVES"
KS="$CHAVES/$APP_ID.keystore"
PROPS="$CHAVES/$APP_ID.senha"
if [ ! -f "$KS" ]; then
  # Chave criada uma vez só. GUARDE a pasta de chaves: sem ela, versões novas não
  # instalam por cima da antiga e seria preciso desinstalar (perdendo os dados do app).
  SENHA="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 24)"
  "$KEYTOOL" -genkeypair -keystore "$KS" -alias app -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$SENHA" -keypass "$SENHA" -dname "CN=$NOME_APK" >/dev/null 2>&1
  printf 'senha=%s\n' "$SENHA" > "$PROPS"
fi
SENHA="$(sed -n 's/^senha=//p' "$PROPS" | tr -d '\r')"
"$JAVA" -jar "$BT/lib/apksigner.jar" sign --ks "$KS" --ks-key-alias app \
  --ks-pass "pass:$SENHA" --key-pass "pass:$SENHA" --out "$APK" "$OUT/alinhado.apk"
"$JAVA" -jar "$BT/lib/apksigner.jar" verify "$APK"
rm -f "$APK.idsig"

echo "Pronto: $APK ($(du -h "$APK" | cut -f1))"
