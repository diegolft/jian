# Implantação

O Gateway roda de três formas. A primeira usa o clone do repositório; as outras duas usam a mesma imagem publicada, `ghcr.io/lucasaarch/jian-gateway`, com o banco por sua conta. A migração do banco roda sozinha na subida do processo: não existe passo separado de migração, e uma versão nova aplica o que falta ao iniciar.

A imagem é um índice multiarquitetura com `linux/amd64` e `linux/arm64`, construído em executores nativos e com comprovante de origem anexado. Para conferir antes de subir:

```bash
gh attestation verify oci://ghcr.io/lucasaarch/jian-gateway:latest --repo lucasaarch/jian
```

## Modo 1 — clone e Compose

Sobe o Gateway e o PostgreSQL juntos. É o caminho para quem hospeda em uma máquina só.

```bash
git clone https://github.com/lucasaarch/jian.git && cd jian
make setup
make up
```

`make setup` escreve `.env` com modo `0600`, contendo token administrativo, senha do banco e keyring de criptografia; ele nunca imprime um segredo. `make up` baixa a imagem, espera o banco ficar são e só então sobe o Gateway. `make logs` acompanha o registro, `make ps` mostra o estado e `make down` derruba a pilha sem apagar o volume.

O `compose.yaml` publica o Gateway em `127.0.0.1:4310`. Para expor além do localhost, coloque um proxy HTTPS na frente e mude o endereço pelas variáveis `JIAN_BIND_ADDRESS` e `JIAN_BIND_PORT`. A porta do PostgreSQL não é publicada: ele só é alcançado pelo Gateway, pela rede do Compose.

`JIAN_VERSION` fixa a versão da imagem; sem ela, o Compose usa `latest`. Para rodar a sua própria construção em vez da imagem publicada, descomente o bloco `build:` em `compose.yaml` e use `docker compose up -d --build`.

O `compose.dev.yaml` é outra coisa: sobe só o PostgreSQL, em `127.0.0.1:5432`, para o `pnpm dev` rodar na máquina. Ele tem nome de projeto e volume próprios, então o banco de desenvolvimento e o de produção não compartilham dado algum, mesmo na mesma máquina.

## Modo 2 — imagem avulsa

Com um PostgreSQL que já é seu:

```bash
docker run -d --name jian --restart unless-stopped \
  -p 127.0.0.1:4310:4310 \
  -e DATABASE_URL='postgres://usuario:senha@banco.interno:5432/jian' \
  -e JIAN_API_TOKEN="$JIAN_API_TOKEN" \
  -e JIAN_ACTIVE_KEY_ID=v1 \
  -e JIAN_MASTER_KEYS="$JIAN_MASTER_KEYS" \
  ghcr.io/lucasaarch/jian-gateway:latest
```

A imagem já traz uma verificação de saúde batendo em `/health`; `docker ps` mostra o resultado. O processo roda como o usuário `node`, sem privilégio, e não escreve nada fora do banco.

## Modo 3 — Kubernetes

A mesma imagem, com os segredos em um `Secret` e o serviço interno ao cluster. Mantenha `replicas: 1` enquanto houver migração pendente: a migração roda na subida e réplicas simultâneas competem por ela. Depois de aplicada, mais réplicas são seguras.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: jian
type: Opaque
stringData:
  DATABASE_URL: postgres://jian:senha@postgres:5432/jian
  JIAN_API_TOKEN: troque-por-um-token-aleatorio-de-32-caracteres
  JIAN_ACTIVE_KEY_ID: v1
  JIAN_MASTER_KEYS: '{"v1":"troque-por-32-bytes-aleatorios-em-base64"}'
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jian
spec:
  replicas: 1
  selector:
    matchLabels: { app: jian }
  template:
    metadata:
      labels: { app: jian }
    spec:
      containers:
        - name: gateway
          image: ghcr.io/lucasaarch/jian-gateway:0.1.0
          envFrom:
            - secretRef: { name: jian }
          env:
            - name: HOST
              value: 0.0.0.0
          ports:
            - containerPort: 4310
          readinessProbe:
            httpGet: { path: /health, port: 4310 }
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /health, port: 4310 }
            initialDelaySeconds: 30
            periodSeconds: 30
          securityContext:
            runAsNonRoot: true
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
---
apiVersion: v1
kind: Service
metadata:
  name: jian
spec:
  selector: { app: jian }
  ports:
    - port: 80
      targetPort: 4310
```

Fixe uma versão exata na imagem; `latest` faz um reinício qualquer trocar de código sem aviso. Exponha por Ingress com TLS, nunca pelo `Service` direto.

`JIAN_ROLE=all` roda API e worker no mesmo processo. Para separá-los, use dois Deployments, `api` e `worker`, compartilhando o mesmo banco e o mesmo keyring; só o `api` recebe o `Service`.

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | O que faz |
| --- | --- | --- | --- |
| `DATABASE_URL` | sim | — | Conexão PostgreSQL. O processo migra o esquema ao subir. |
| `JIAN_API_TOKEN` | sim | — | Token administrativo, mínimo de 32 caracteres. Também assina os cookies do painel. |
| `JIAN_ACTIVE_KEY_ID` | sim | — | Identificador da chave do keyring usada em gravações novas. |
| `JIAN_MASTER_KEYS` | sim | — | JSON de identificador para chave de 32 bytes em Base64. Mantenha fora do backup do banco. |
| `HOST` | não | `0.0.0.0` na imagem | Endereço de escuta dentro do contêiner. |
| `PORT` | não | `4310` | Porta de escuta; a verificação de saúde a respeita. |
| `JIAN_ROLE` | não | `all` | `all`, `api` ou `worker`. |
| `JIAN_ALLOW_PRIVATE_ORIGINS` | não | vazio | Origens privadas exatas liberadas para saída, por exemplo `http://127.0.0.1:11434`. |
| `POSTGRES_PASSWORD` | só no Compose | — | Senha do PostgreSQL do `compose.yaml`; também compõe o `DATABASE_URL` do serviço. |
| `JIAN_VERSION` | só no Compose | `latest` | Etiqueta da imagem usada pelo `compose.yaml`. |
| `JIAN_BIND_ADDRESS` | só no Compose | `127.0.0.1` | Endereço do host onde a porta do Gateway é publicada. |
| `JIAN_BIND_PORT` | só no Compose | `4310` | Porta do host onde o Gateway é publicado. |

As chaves de provider, MCP e canal não ficam no ambiente: são digitadas no painel e guardadas cifradas com o keyring. Veja [segurança](security.md).

## Etiquetas publicadas

| Etiqueta | Quando é escrita |
| --- | --- |
| `edge` | Todo push na `main`. É o estado da branch, não uma versão. |
| `a1b2c3d` | Todo push na `main`, com o commit curto. Serve para prender uma build específica. |
| `1.2.3` | Tag `v1.2.3`. É a única imutável. |
| `1.2` | Tag `v1.2.3`; anda para a correção mais recente da série. |
| `latest` | Tag `v1.2.3`; anda para a versão publicada mais recente. |

## Atualizar e voltar atrás

Atualizar é trocar a etiqueta e subir de novo. A migração roda na subida.

```bash
# Compose: fixe a versão em .env e reconstrua o contêiner
echo 'JIAN_VERSION=1.3.0' >> .env && make up

# Contêiner avulso
docker pull ghcr.io/lucasaarch/jian-gateway:1.3.0
docker rm -f jian && docker run -d --name jian ... ghcr.io/lucasaarch/jian-gateway:1.3.0

# Kubernetes
kubectl set image deployment/jian gateway=ghcr.io/lucasaarch/jian-gateway:1.3.0
```

Antes de atualizar, faça um dump: a migração altera o esquema e não tem volta automática.

```bash
docker compose exec postgres pg_dump -U jian -Fc jian > jian-$(date +%F).dump
```

Voltar atrás é apontar para a versão anterior — `make up` com outro `JIAN_VERSION`, ou `kubectl rollout undo deployment/jian`. Isso reverte o código, **não** o esquema: uma migração já aplicada continua no banco. Se a versão anterior não aceitar o esquema novo, restaure o dump:

```bash
docker compose exec -T postgres pg_restore -U jian -d jian --clean --if-exists < jian-2026-09-22.dump
```

Migrações publicadas são imutáveis; uma correção vem como versão seguinte, nunca como alteração da anterior.

## Onde ficam os dados

Tudo que persiste está no PostgreSQL: perfis, sessões, histórico, memórias, runs, a fila do pg-boss e o cofre de credenciais. O contêiner do Gateway não guarda estado — derrubá-lo e recriá-lo não perde nada.

No Compose, o banco fica no volume nomeado `jian_postgres_data`; o banco de desenvolvimento fica em `jian-dev_postgres_data`. `make down` preserva o volume, `docker compose down -v` o apaga. `make db-reset` apaga o de desenvolvimento de propósito.

O keyring `JIAN_MASTER_KEYS` fica fora do banco, no `.env` ou no gerenciador de segredos. Sem ele, um backup do banco é inútil: os segredos do cofre não abrem. Guarde-o separado, e preserve as entradas antigas até todo segredo ter sido reenviado com a chave nova.

## Publicação

O workflow `Image` constrói a imagem em dois executores nativos, `ubuntu-24.04` e `ubuntu-24.04-arm`, cada um publicando por digest, e um trabalho final une os dois em um índice multiarquitetura. Não há emulação.

O Release Please mantém um pull request de versão aberto, acumulando os commits convencionais desde a última publicação. Fazer o merge dele escreve a versão no `package.json`, o `CHANGELOG.md` e a tag `v1.2.3`; a tag é o que dispara a publicação da imagem.

Para isso funcionar, o dono precisa ligar uma permissão que vem desligada: em **Settings → Actions → General → Workflow permissions**, marque **Allow GitHub Actions to create and approve pull requests**. Sem ela, o workflow falha ao abrir o pull request de versão.
