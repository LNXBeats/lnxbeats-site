// Public interface only. No payment amounts, statuses, contracts or catalogue data are changed.
export const digitalMessages: Record<string, readonly [string,string,string,string,string]> = {
  "Votre commande": [
    "Your order",
    "Tu pedido",
    "A sua encomenda",
    "您的订单",
    "ご注文"
  ],
  "article": [
    "item",
    "artículo",
    "artigo",
    "件商品",
    "点"
  ],
  "articles": [
    "items",
    "artículos",
    "artigos",
    "件商品",
    "点"
  ],
  "{count} article": [
    "{count} item",
    "{count} artículo",
    "{count} artigo",
    "{count} 件商品",
    "{count} 点"
  ],
  "{count} articles": [
    "{count} items",
    "{count} artículos",
    "{count} artigos",
    "{count} 件商品",
    "{count} 点"
  ],
  "{count} pistes · Album": [
    "{count} tracks · Album",
    "{count} canciones · Álbum",
    "{count} faixas · Álbum",
    "{count} 首曲目 · 专辑",
    "{count} 曲・アルバム"
  ],
  "{count} articles · WAV et MP3 inclus": [
    "{count} items · WAV and MP3 included",
    "{count} artículos · WAV y MP3 incluidos",
    "{count} artigos · WAV e MP3 incluídos",
    "{count} 件商品 · 包含 WAV 和 MP3",
    "{count} 点・WAV と MP3 込み"
  ],
  "Album · {count} pistes": [
    "Album · {count} tracks",
    "Álbum · {count} canciones",
    "Álbum · {count} faixas",
    "专辑 · {count} 首曲目",
    "アルバム・{count} 曲"
  ],
  "Total de démonstration": [
    "Demo total",
    "Total de demostración",
    "Total de demonstração",
    "演示总额",
    "デモ合計"
  ],
  "France": [
    "France",
    "Francia",
    "França",
    "法国",
    "フランス"
  ],
  "Adresse de facturation · France": [
    "Billing address · France",
    "Dirección de facturación · Francia",
    "Morada de faturação · França",
    "账单地址 · 法国",
    "請求先住所・フランス"
  ],
  "Votre complément": [
    "Your album completion",
    "Tu compra para completar el álbum",
    "O complemento do seu álbum",
    "您的专辑补齐购买",
    "アルバムの補完購入"
  ],
  "Aucun paiement supplémentaire n’est nécessaire.": [
    "No additional payment is required.",
    "No se requiere ningún pago adicional.",
    "Não é necessário qualquer pagamento adicional.",
    "无需额外付款。",
    "追加のお支払いは不要です。"
  ],
  "Obtenir mon complément": [
    "Get my album completion",
    "Obtener el resto del álbum",
    "Obter o complemento do álbum",
    "获取专辑剩余内容",
    "アルバムの残りを取得"
  ],
  "Simulation locale uniquement. Aucun paiement réel.": [
    "Local simulation only. No real payment.",
    "Solo simulación local. Ningún pago real.",
    "Apenas simulação local. Nenhum pagamento real.",
    "仅限本地模拟，不涉及真实付款。",
    "ローカルのシミュレーションのみです。実際の決済はありません。"
  ],
  "Simuler le paiement local": [
    "Simulate local payment",
    "Simular el pago local",
    "Simular pagamento local",
    "模拟本地付款",
    "ローカル決済を模擬"
  ],
  "Préparation…": [
    "Preparing…",
    "Preparando…",
    "A preparar…",
    "正在准备…",
    "準備中…"
  ],
  "Préparation sécurisée…": [
    "Preparing securely…",
    "Preparando de forma segura…",
    "A preparar com segurança…",
    "正在安全准备…",
    "安全に準備中…"
  ],
  "Choisissez votre moyen de paiement": [
    "Choose your payment method",
    "Elige tu método de pago",
    "Escolha o meio de pagamento",
    "选择付款方式",
    "お支払い方法を選択"
  ],
  "Total commun aux deux moyens de paiement": [
    "Same total for both payment methods",
    "Mismo total para ambos métodos de pago",
    "Total igual para ambos os meios de pagamento",
    "两种付款方式的总额相同",
    "どちらの決済方法でも合計は同じです"
  ],
  "Consulter Ma musique avant une nouvelle tentative": [
    "Check My music before trying again",
    "Consulta Mi música antes de volver a intentarlo",
    "Consulte A minha música antes de tentar novamente",
    "再次尝试前请查看“我的音乐”",
    "再試行の前にマイミュージックを確認"
  ],
  "Choisissez les pistes": [
    "Choose tracks",
    "Elegir canciones",
    "Escolher faixas",
    "选择曲目",
    "曲を選ぶ"
  ],
  "Titres déjà payés, après remboursements": [
    "Tracks already paid for, after refunds",
    "Canciones ya pagadas, descontando reembolsos",
    "Faixas já pagas, após reembolsos",
    "已付费曲目（扣除退款后）",
    "返金を反映した購入済みの曲"
  ],
  "Vider la sélection numérique": [
    "Clear the digital selection",
    "Vaciar la selección digital",
    "Limpar a seleção digital",
    "清空数字音乐选择",
    "デジタル音楽の選択を空にする"
  ],
  "Cela n’annule pas un paiement déjà engagé.": [
    "This does not cancel a payment already started.",
    "Esto no cancela un pago ya iniciado.",
    "Isto não cancela um pagamento já iniciado.",
    "这不会取消已发起的付款。",
    "開始済みの決済はキャンセルされません。"
  ],
  "Les titres inclus dans un album ne sont pas facturés deux fois. Un complément d’album déduit seulement les achats éligibles déjà payés, après remboursements.": [
    "Tracks included in an album are not charged twice. Album completion deducts only eligible paid purchases, after refunds.",
    "Las canciones incluidas en un álbum no se cobran dos veces. Al completar un álbum solo se descuentan compras pagadas elegibles, tras los reembolsos.",
    "As faixas incluídas num álbum não são cobradas duas vezes. O complemento deduz apenas compras elegíveis já pagas, após reembolsos.",
    "专辑中包含的曲目不会重复收费。补齐专辑仅抵扣扣除退款后的合资格已付款购买。",
    "アルバムに含まれる曲は二重に請求されません。補完購入では、返金を反映した対象の支払済み購入分のみが控除されます。"
  ],
  "Les titres inclus dans l’album ont été retirés : ils ne seront pas facturés deux fois.": [
    "Tracks covered by the album were removed to avoid charging twice.",
    "Se han retirado las canciones incluidas en el álbum para no cobrarlas dos veces.",
    "As faixas incluídas no álbum foram retiradas para evitar uma cobrança duplicada.",
    "已移除专辑中包含的单曲，避免重复收费。",
    "二重請求を避けるため、アルバムに含まれる単曲を選択から外しました。"
  ],
  "{title} a été retiré du panier.": [
    "{title} was removed from the cart.",
    "Se ha retirado {title} del carrito.",
    "{title} foi retirado do carrinho.",
    "已从购物车移除 {title}。",
    "{title} をカートから削除しました。"
  ],
  "Retirer {title} du panier": [
    "Remove {title} from the cart",
    "Retirar {title} del carrito",
    "Retirar {title} do carrinho",
    "从购物车移除 {title}",
    "{title} をカートから削除"
  ],
  "Sélection à vérifier avant tout paiement.": [
    "Your selection must be checked before payment.",
    "La selección debe verificarse antes del pago.",
    "É necessário verificar a seleção antes do pagamento.",
    "付款前须核实您的选择。",
    "お支払いの前に選択内容の確認が必要です。"
  ],
  "Vérification de votre sélection…": [
    "Checking your selection…",
    "Verificando tu selección…",
    "A verificar a sua seleção…",
    "正在核实您的选择…",
    "選択内容を確認中…"
  ],
  "Tarifs de test, non définitifs.": [
    "Test prices, not final.",
    "Precios de prueba, no definitivos.",
    "Preços de teste, não definitivos.",
    "测试价格，并非最终价格。",
    "テスト価格です。確定価格ではありません。"
  ],
  "Vérification…": [
    "Checking…",
    "Verificando…",
    "A verificar…",
    "正在核实…",
    "確認中…"
  ],
  "Panier indisponible.": [
    "Cart unavailable.",
    "Carrito no disponible.",
    "Carrinho indisponível.",
    "购物车暂不可用。",
    "カートを利用できません。"
  ],
  "Le navigateur n’a pas pu modifier le panier. Réessayez.": [
    "Your browser could not update the cart. Please try again.",
    "El navegador no ha podido modificar el carrito. Inténtalo de nuevo.",
    "O navegador não conseguiu atualizar o carrinho. Tente novamente.",
    "浏览器无法更新购物车，请重试。",
    "ブラウザーでカートを更新できませんでした。再度お試しください。"
  ],
  "Le navigateur n’a pas pu modifier le panier.": [
    "Your browser could not update the cart.",
    "El navegador no ha podido modificar el carrito.",
    "O navegador não conseguiu atualizar o carrinho.",
    "浏览器无法更新购物车。",
    "ブラウザーでカートを更新できませんでした。"
  ],
  "Votre panier nécessite une vérification.": [
    "Your cart needs to be checked.",
    "Es necesario verificar tu carrito.",
    "É necessário verificar o carrinho.",
    "您的购物车需要核实。",
    "カートの確認が必要です。"
  ],
  "Connexion requise.": [
    "Sign-in required.",
    "Debes iniciar sesión.",
    "É necessário iniciar sessão.",
    "请先登录。",
    "ログインが必要です。"
  ],
  "Action indisponible.": [
    "Action unavailable.",
    "Acción no disponible.",
    "Ação indisponível.",
    "此操作暂不可用。",
    "この操作は現在利用できません。"
  ],
  "Autorisation…": [
    "Authorizing…",
    "Autorizando…",
    "A autorizar…",
    "正在授权…",
    "権限を確認中…"
  ],
  "Téléchargement indisponible.": [
    "Download unavailable.",
    "Descarga no disponible.",
    "Download indisponível.",
    "下载暂不可用。",
    "ダウンロードを利用できません。"
  ],
  "Les pistes accessibles restent téléchargeables. La préparation de l’archive doit être vérifiée par l’Admin.": [
    "Available tracks can still be downloaded. The archive preparation requires an Admin check.",
    "Las canciones accesibles siguen disponibles para descargar. El administrador debe revisar la preparación del archivo.",
    "As faixas acessíveis continuam disponíveis para download. A preparação do arquivo requer verificação pela Administração.",
    "可访问的曲目仍可单独下载。压缩包的准备情况需要管理员核实。",
    "利用できる曲は引き続きダウンロードできます。アーカイブの準備は管理者による確認が必要です。"
  ],
  "Finaliser après approbation PayPal": [
    "Complete after PayPal approval",
    "Finalizar tras la aprobación de PayPal",
    "Concluir após aprovação no PayPal",
    "PayPal 批准后完成",
    "PayPal 承認後に完了する"
  ],
  "Finaliser après approbation PayPal Sandbox": [
    "Complete after PayPal Sandbox approval",
    "Finalizar tras la aprobación de PayPal Sandbox",
    "Concluir após aprovação no PayPal Sandbox",
    "PayPal Sandbox 批准后完成",
    "PayPal Sandbox 承認後に完了する"
  ],
  "Paiement confirmé. Votre musique est disponible.": [
    "Payment confirmed. Your music is available.",
    "Pago confirmado. Tu música está disponible.",
    "Pagamento confirmado. A sua música está disponível.",
    "付款已确认，您的音乐已可使用。",
    "お支払いを確認しました。音楽をご利用いただけます。"
  ],
  "Résultat à vérifier. Ne recommencez pas le paiement.": [
    "The result needs checking. Do not pay again.",
    "Hay que verificar el resultado. No repitas el pago.",
    "O resultado precisa de verificação. Não repita o pagamento.",
    "结果需要核实，请勿重复付款。",
    "結果の確認が必要です。お支払いを繰り返さないでください。"
  ],
  "Paiement en attente de confirmation serveur.": [
    "Payment awaiting server confirmation.",
    "Pago pendiente de confirmación del servidor.",
    "Pagamento a aguardar confirmação do servidor.",
    "付款等待服务器确认。",
    "サーバーによる決済の確認を待っています。"
  ],
  "Vérification indisponible.": [
    "Verification unavailable.",
    "Verificación no disponible.",
    "Verificação indisponível.",
    "核实功能暂不可用。",
    "現在確認できません。"
  ],
  "Votre sélection musicale": [
    "Your music selection",
    "Tu selección musical",
    "A sua seleção musical",
    "您的音乐选择",
    "選択した音楽"
  ],
  "Album acheté": [
    "Purchased album",
    "Álbum comprado",
    "Álbum adquirido",
    "已购买专辑",
    "購入したアルバム"
  ],
  "{count} piste acquise": [
    "{count} purchased track",
    "{count} canción adquirida",
    "{count} faixa adquirida",
    "已购买 {count} 首曲目",
    "購入済み {count} 曲"
  ],
  "{count} pistes acquises": [
    "{count} purchased tracks",
    "{count} canciones adquiridas",
    "{count} faixas adquiridas",
    "已购买 {count} 首曲目",
    "購入済み {count} 曲"
  ],
  "{count} disponible": [
    "{count} available",
    "{count} disponible",
    "{count} disponível",
    "{count} 首可用",
    "{count} 曲利用可能"
  ],
  "{count} disponibles": [
    "{count} available",
    "{count} disponibles",
    "{count} disponíveis",
    "{count} 首可用",
    "{count} 曲利用可能"
  ],
  "Réf. abrégée": [
    "Short reference",
    "Referencia abreviada",
    "Referência abreviada",
    "简短参考号",
    "短縮参照番号"
  ],
  "ZIP original": [
    "Original ZIP",
    "ZIP original",
    "ZIP original",
    "原始 ZIP",
    "元の ZIP"
  ],
  "Télécharger {format}": [
    "Download {format}",
    "Descargar {format}",
    "Descarregar {format}",
    "下载 {format}",
    "{format} をダウンロード"
  ],
  "{format} indisponible": [
    "{format} unavailable",
    "{format} no disponible",
    "{format} indisponível",
    "{format} 暂不可用",
    "{format} を利用できません"
  ],
  "Vérifier {format}": [
    "Check {format}",
    "Verificar {format}",
    "Verificar {format}",
    "核实 {format}",
    "{format} を確認"
  ],
  "Préparer {format}": [
    "Prepare {format}",
    "Preparar {format}",
    "Preparar {format}",
    "准备 {format}",
    "{format} を準備"
  ],
  "Télécharger l’original": [
    "Download original",
    "Descargar el original",
    "Descarregar o original",
    "下载原始文件",
    "元のファイルをダウンロード"
  ],
  "Informations de fichier non documentées": [
    "File information not documented",
    "Información del archivo no documentada",
    "Informações do ficheiro não documentadas",
    "文件信息尚未记录",
    "ファイル情報は未記録です"
  ],
  "Version acquise {version}. Le contenu acheté reste conservé.": [
    "Purchased version {version}. The purchased content is preserved.",
    "Versión adquirida {version}. Se conserva el contenido comprado.",
    "Versão adquirida {version}. O conteúdo comprado é preservado.",
    "所购版本 {version}。已购买的内容将保留。",
    "購入したバージョン {version}。購入済みの内容は保持されます。"
  ],
  "Achat historique : format original conservé, sans conversion rétroactive.": [
    "Historical purchase: original format preserved, with no retroactive conversion.",
    "Compra histórica: se conserva el formato original, sin conversión retroactiva.",
    "Compra histórica: formato original preservado, sem conversão retroativa.",
    "历史购买：保留原始格式，不进行追溯转换。",
    "過去の購入：元の形式を保持し、遡って変換しません。"
  ],
  "WAV et MP3 inclus dans cet achat.": [
    "WAV and MP3 included in this purchase.",
    "WAV y MP3 incluidos en esta compra.",
    "WAV e MP3 incluídos nesta compra.",
    "本次购买包含 WAV 和 MP3。",
    "この購入には WAV と MP3 が含まれます。"
  ],
  "Accès retiré": [
    "Access revoked",
    "Acceso retirado",
    "Acesso retirado",
    "访问权限已撤销",
    "アクセス権を取り消しました"
  ],
  "Accès suspendu": [
    "Access suspended",
    "Acceso suspendido",
    "Acesso suspenso",
    "访问权限已暂停",
    "アクセスを一時停止中"
  ],
  "Rétractation ou réclamation concernant cet achat": [
    "Withdrawal or complaint about this purchase",
    "Desistimiento o reclamación sobre esta compra",
    "Livre resolução ou reclamação relativa a esta compra",
    "关于本次购买的撤回或投诉",
    "この購入に関する撤回・苦情"
  ],
  "Informations de démonstration": [
    "Demo information",
    "Información de demostración",
    "Informações da demonstração",
    "演示信息",
    "デモ情報"
  ],
  "Prix et documents fictifs, sans valeur comptable ou fiscale. Les versions exactes sont liées à cet achat. Aucun paiement réel, avantage Commander ou licence de publication n’est créé.": [
    "Fictitious prices and documents, with no accounting or tax value. Exact versions are linked to this purchase. No real payment, commission benefit or publishing licence is created.",
    "Precios y documentos ficticios, sin valor contable ni fiscal. Las versiones exactas se vinculan a esta compra. No se genera ningún pago real, ventaja de encargos ni licencia de publicación.",
    "Preços e documentos fictícios, sem valor contabilístico ou fiscal. As versões exatas estão ligadas a esta compra. Não é criado nenhum pagamento real, vantagem de encomenda ou licença de publicação.",
    "价格与文件均为虚构，不具会计或税务效力。确切版本与本次购买关联，不产生真实付款、定制服务优惠或发布许可。",
    "架空の価格と書類であり、会計・税務上の効力はありません。正確なバージョンを購入に紐づけます。実際の決済、制作依頼の特典、公開許諾は発生しません。"
  ],
  "Les versions exactes sont liées à cet achat. La licence est réservée à un usage privé, sans droit de publication ou d’exploitation commerciale.": [
    "The exact versions are linked to this purchase. The licence is for private use only and grants no publishing or commercial exploitation rights.",
    "Las versiones exactas se vinculan a esta compra. La licencia es solo para uso privado y no concede derechos de publicación ni explotación comercial.",
    "As versões exatas estão ligadas a esta compra. A licença é apenas para uso privado, sem direitos de publicação ou exploração comercial.",
    "确切版本与本次购买关联。许可仅限私人使用，不授予发布或商业使用权。",
    "正確なバージョンを購入に紐づけます。個人利用限定のライセンスであり、公開・商用利用の権利は付与されません。"
  ],
  "{count} PDF disponibles": [
    "{count} PDFs available",
    "{count} PDF disponibles",
    "{count} PDF disponíveis",
    "{count} 份 PDF 可用",
    "PDF {count} 件を利用可能"
  ],
  "Documents de démonstration — sans valeur comptable ou fiscale.": [
    "Demo documents — no accounting or tax value.",
    "Documentos de demostración, sin valor contable ni fiscal.",
    "Documentos de demonstração — sem valor contabilístico ou fiscal.",
    "演示文件，不具会计或税务效力。",
    "デモ書類です。会計・税務上の効力はありません。"
  ],
  "Justificatifs réservés après confirmation effective du paiement.": [
    "Documents are reserved once payment is actually confirmed.",
    "Los justificantes se reservan tras confirmar efectivamente el pago.",
    "Os comprovativos são reservados após confirmação efetiva do pagamento.",
    "凭证将在付款实际确认后提供。",
    "決済の確認後に書類が用意されます。"
  ],
  "Conservez votre confirmation avant d’accéder aux fichiers. La demande de téléchargement ne suffit pas à reconnaître sa réception.": [
    "Keep your confirmation before accessing the files. Requesting a download does not by itself acknowledge receipt.",
    "Guarda tu confirmación antes de acceder a los archivos. Solicitar la descarga no basta para reconocer su recepción.",
    "Guarde a confirmação antes de aceder aos ficheiros. Pedir o download não basta para reconhecer a receção.",
    "访问文件前请保存确认书。仅请求下载并不代表已确认收到。",
    "ファイルにアクセスする前に確認書を保存してください。ダウンロードを要求しただけでは受領確認になりません。"
  ],
  "Confirmer la réception et commencer la fourniture": [
    "Confirm receipt and start delivery",
    "Confirmar la recepción e iniciar el suministro",
    "Confirmar a receção e iniciar o fornecimento",
    "确认收到并开始提供内容",
    "受領を確認し、提供を開始"
  ],
  "Confirmer la réception et commencer la fourniture QA": [
    "Confirm receipt and start QA delivery",
    "Confirmar la recepción e iniciar el suministro QA",
    "Confirmar a receção e iniciar o fornecimento QA",
    "确认收到并开始 QA 提供",
    "受領を確認し、QA 提供を開始"
  ],
  "Réception de la confirmation enregistrée.": [
    "Receipt of the confirmation recorded.",
    "Se ha registrado la recepción de la confirmación.",
    "Receção da confirmação registada.",
    "已记录确认书的接收。",
    "確認書の受領を記録しました。"
  ],
  "Confirmation reçue dans cette démonstration.": [
    "Confirmation received in this demo.",
    "Confirmación recibida en esta demostración.",
    "Confirmação recebida nesta demonstração.",
    "此演示中已收到确认书。",
    "このデモで確認書を受領しました。"
  ],
  "Réception à vérifier.": [
    "Receipt needs checking.",
    "Recepción pendiente de verificación.",
    "Receção a verificar.",
    "接收情况需要核实。",
    "受領の確認が必要です。"
  ],
  "Conservez les fichiers téléchargés sur votre appareil. Un transfert serveur ne prouve pas leur stockage ni leur lecture.": [
    "Keep the downloaded files on your device. A server transfer does not prove that they were saved or read.",
    "Guarda los archivos descargados en tu dispositivo. Una transferencia del servidor no prueba que se hayan guardado o leído.",
    "Guarde os ficheiros descarregados no seu dispositivo. Uma transferência do servidor não prova o armazenamento ou a leitura.",
    "请将下载的文件保存在设备上。服务器传输不能证明文件已保存或已阅读。",
    "ダウンロードしたファイルは端末に保存してください。サーバーからの転送は、保存や閲覧の証明にはなりません。"
  ],
  "Complément gratuit": [
    "Free album completion",
    "Completar álbum sin pago",
    "Complemento gratuito do álbum",
    "免费补齐专辑",
    "無料のアルバム補完"
  ],
  "Paiement numérique": [
    "Digital payment",
    "Pago digital",
    "Pagamento digital",
    "数字付款",
    "デジタル決済"
  ],
  "Votre complément est attribué.": [
    "Your album completion has been granted.",
    "Se ha concedido el resto de tu álbum.",
    "O complemento do álbum foi atribuído.",
    "已授予您的专辑补齐内容。",
    "アルバムの補完分を付与しました。"
  ],
  "Suivi de votre fourniture": [
    "Your delivery status",
    "Estado del suministro",
    "Estado do fornecimento",
    "内容提供状态",
    "提供状況"
  ],
  "Diagnostics de la démonstration": [
    "Demo diagnostics",
    "Diagnóstico de demostración",
    "Diagnóstico da demonstração",
    "演示诊断",
    "デモの診断情報"
  ],
  "réception enregistrée": [
    "receipt recorded",
    "recepción registrada",
    "receção registada",
    "已记录接收",
    "受領を記録済み"
  ],
  "à conserver avant fourniture": [
    "save before delivery",
    "guardar antes del suministro",
    "guardar antes do fornecimento",
    "提供内容前请保存",
    "提供開始前に保存"
  ],
  "acquisition historique conservée": [
    "historical purchase preserved",
    "compra histórica conservada",
    "aquisição histórica preservada",
    "已保留历史购买",
    "過去の購入を保持"
  ],
  "selon les droits actifs": [
    "according to active rights",
    "según los derechos activos",
    "conforme os direitos ativos",
    "依据有效权限",
    "有効な権利に従う"
  ],
  "non commencé": [
    "not started",
    "no iniciado",
    "não iniciado",
    "尚未开始",
    "未開始"
  ],
  "Accès": [
    "Access",
    "Acceso",
    "Acesso",
    "访问",
    "アクセス"
  ],
  "Page": [
    "Page",
    "Página",
    "Página",
    "页",
    "ページ"
  ],
  "Achats plus récents": [
    "Newer purchases",
    "Compras más recientes",
    "Compras mais recentes",
    "较新的购买",
    "新しい購入"
  ],
  "Achats précédents": [
    "Earlier purchases",
    "Compras anteriores",
    "Compras anteriores",
    "较早的购买",
    "以前の購入"
  ],
  "Votre musique, à emporter": [
    "Your music to keep",
    "Tu música para llevar",
    "A sua música, para levar",
    "随身珍藏您的音乐",
    "音楽を、手元に"
  ],
  "Finaliser mon achat": [
    "Complete my purchase",
    "Finalizar mi compra",
    "Concluir a minha compra",
    "完成购买",
    "購入手続き"
  ],
  "La sélection a changé. Retournez au panier avant de payer.": [
    "The selection has changed. Return to the cart before paying.",
    "La selección ha cambiado. Vuelve al carrito antes de pagar.",
    "A seleção mudou. Volte ao carrinho antes de pagar.",
    "选择已更改，请在付款前返回购物车。",
    "選択内容が変わりました。お支払いの前にカートへ戻ってください。"
  ],
  "Les conditions de vente ne sont pas encore disponibles pour un nouvel achat.": [
    "The terms of sale are not yet available for a new purchase.",
    "Las condiciones de venta aún no están disponibles para una nueva compra.",
    "As condições de venda ainda não estão disponíveis para uma nova compra.",
    "新购买所需的销售条款尚不可用。",
    "新しい購入に必要な販売条件を現在利用できません。"
  ],
  "Complétez l’adresse et les confirmations pour afficher le bouton PayPal sécurisé.": [
    "Complete your address and confirmations to display the secure PayPal button.",
    "Completa tu dirección y las confirmaciones para mostrar el botón seguro de PayPal.",
    "Preencha a morada e as confirmações para mostrar o botão PayPal seguro.",
    "请填写地址并完成确认，以显示安全的 PayPal 按钮。",
    "住所と確認事項を入力すると、安全な PayPal ボタンが表示されます。"
  ],
  "PayPal est temporairement indisponible. Vous pouvez choisir le paiement par carte.": [
    "PayPal is temporarily unavailable. You can choose card payment.",
    "PayPal no está disponible temporalmente. Puedes pagar con tarjeta.",
    "O PayPal está temporariamente indisponível. Pode escolher o pagamento por cartão.",
    "PayPal 暂不可用，您可以选择银行卡付款。",
    "PayPal は一時的に利用できません。カード決済を選択できます。"
  ],
  "Chargement du bouton PayPal sécurisé…": [
    "Loading the secure PayPal button…",
    "Cargando el botón seguro de PayPal…",
    "A carregar o botão PayPal seguro…",
    "正在加载安全的 PayPal 按钮…",
    "安全な PayPal ボタンを読み込み中…"
  ],
  "PayPal n’est pas disponible sur cet appareil. Vous pouvez choisir le paiement par carte.": [
    "PayPal is not available on this device. You can choose card payment.",
    "PayPal no está disponible en este dispositivo. Puedes pagar con tarjeta.",
    "O PayPal não está disponível neste dispositivo. Pode escolher o pagamento por cartão.",
    "此设备上无法使用 PayPal，您可以选择银行卡付款。",
    "この端末では PayPal を利用できません。カード決済を選択できます。"
  ],
  "Réessayer la préparation PayPal": [
    "Retry PayPal preparation",
    "Reintentar la preparación de PayPal",
    "Repetir a preparação PayPal",
    "重新准备 PayPal",
    "PayPal の準備を再試行"
  ],
  "Réessayer le chargement PayPal": [
    "Reload PayPal button",
    "Volver a cargar PayPal",
    "Voltar a carregar o PayPal",
    "重新加载 PayPal",
    "PayPal ボタンを再読み込み"
  ],
  "Paiement sécurisé PayPal": [
    "Secure PayPal payment",
    "Pago seguro con PayPal",
    "Pagamento PayPal seguro",
    "PayPal 安全付款",
    "PayPal による安全な決済"
  ],
  "La préparation a été refusée avant l’ouverture de PayPal. Vérifiez le message, puis réessayez lorsque le problème est résolu.": [
    "Preparation was refused before opening PayPal. Check the message and try again only when the issue is resolved.",
    "La preparación se ha rechazado antes de abrir PayPal. Revisa el mensaje y vuelve a intentarlo cuando se haya resuelto el problema.",
    "A preparação foi recusada antes de abrir o PayPal. Verifique a mensagem e tente novamente apenas quando o problema estiver resolvido.",
    "在打开 PayPal 前，准备请求已被拒绝。请查看提示，仅在问题解决后重试。",
    "PayPal を開く前に準備が拒否されました。メッセージを確認し、問題が解決してから再試行してください。"
  ],
  "Le bouton PayPal n’a pas pu être chargé. Réessayez ou rechargez cette page, puis choisissez la carte si nécessaire. Aucun nouveau paiement n’a été lancé.": [
    "The PayPal button could not load. Retry or reload this page, then choose card payment if needed. No new payment was started.",
    "No se ha podido cargar el botón de PayPal. Reintenta o recarga esta página y, si es necesario, paga con tarjeta. No se ha iniciado ningún pago nuevo.",
    "Não foi possível carregar o botão PayPal. Tente novamente ou recarregue a página e escolha o cartão se necessário. Não foi iniciado nenhum novo pagamento.",
    "无法加载 PayPal 按钮。请重试或刷新页面，必要时选择银行卡。未发起任何新付款。",
    "PayPal ボタンを読み込めませんでした。再試行またはページを再読み込みし、必要に応じてカードを選択してください。新しい決済は開始されていません。"
  ],
  "Payer {amount} en toute sécurité": [
    "Pay {amount} securely",
    "Pagar {amount} de forma segura",
    "Pagar {amount} com segurança",
    "安全支付 {amount}",
    "{amount} を安全に支払う"
  ],
  "Payer {amount} avec PayPal": [
    "Pay {amount} with PayPal",
    "Pagar {amount} con PayPal",
    "Pagar {amount} com PayPal",
    "通过 PayPal 支付 {amount}",
    "PayPal で {amount} を支払う"
  ],
  "Payer {amount} — commande avec obligation de paiement": [
    "Pay {amount} — order with an obligation to pay",
    "Pagar {amount} — pedido con obligación de pago",
    "Pagar {amount} — encomenda com obrigação de pagamento",
    "支付 {amount} — 下单即承担付款义务",
    "{amount} を支払う・支払義務を伴う注文"
  ]
};
