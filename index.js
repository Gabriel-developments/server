// index.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const QRCode = require('qrcode');
const path = require('path');
const { MercadoPagoConfig, Preference } = require('mercadopago');

// Configuração do app
const app = express();
app.use(cors());
app.use(express.json());

// Conexão com MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cardapio-digital')
  .then(() => console.log('Conectado ao MongoDB'))
  .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// Modelos (Existing Models)
const Usuario = mongoose.model('Usuario', new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  senha: { type: String, required: true },
  nomeEstabelecimento: String,
  telefoneWhatsapp: String,
  endereco: String,
  horarioFuncionamento: String,
  redesSocial: [String],
  mensagemBoasVindas: String,
  corPrimaria: { type: String, default: '#4F46E5' },
  logoUrl: String,
  qrCodeUrl: String,
  planoAtivo: { type: Boolean, default: false }, // **MODIFICADO: Default é false**
  dataExpiracaoPlano: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
}));

const Categoria = mongoose.model('Categoria', new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  nome: { type: String, required: true },
  ordem: { type: Number, default: 0 }
}));

const Produto = mongoose.model('Produto', new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  categoriaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Categoria', required: true },
  nome: { type: String, required: true },
  descricao: String,
  preco: { type: Number, required: true },
  imageUrl: String,
  disponivel: { type: Boolean, default: true },
  opcoes: [{
    nomeOpcao: String,
    tipo: { type: String, enum: ['selecao_unica', 'multipla_escolha', 'quantidade'], default: 'selecao_unica' },
    min: { type: Number, default: 1 },
    max: { type: Number, default: 1 },
    itens: [{
      nomeItem: String,
      precoExtra: { type: Number, default: 0 }
    }]
  }]
}));

const Pedido = mongoose.model('Pedido', new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  itens: [{
    produtoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Produto', required: true },
    nomeProduto: String,
    precoUnitario: Number,
    quantidade: Number,
    observacoes: String,
    opcoesSelecionadas: [{
      nomeOpcao: String,
      selecao: String,
      precoExtra: { type: Number, default: 0 }
    }]
  }],
  total: { type: Number, required: true },
  clienteNome: { type: String, required: true },
  clienteTelefone: { type: String, required: true },
  clienteEndereco: String,
  observacoes: String,
  status: { type: String, enum: ['pendente', 'confirmado', 'cancelado', 'entregue'], default: 'pendente' },
  dataPedido: { type: Date, default: Date.now }
}));

// Mercado Pago Configuration
const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN, options: { timeout: 5000 } });

// Middleware para verificar a assinatura
const checkSubscription = async (req, res, next) => {
  // Para rotas que precisam de userId no corpo (POST/PUT)
  let userId = req.body.userId || req.params.id;

  // Se a rota for para categorias/produtos/pedidos, o userId vem do path
  if (!userId && req.path.startsWith('/api/categorias/')) {
    userId = req.params.usuarioId;
  }
  if (!userId && req.path.startsWith('/api/produtos/')) {
    userId = req.params.usuarioId;
  }
  if (!userId && req.path.startsWith('/api/pedidos/')) {
    userId = req.params.usuarioId;
  }

  // Se for uma rota de edição ou deleção, o userId pode não estar diretamente no path,
  // mas o ID do documento sendo editado pertence a um usuário.
  // Isso exigiria uma lógica mais complexa (buscar o documento e verificar o owner).
  // Para simplificar, vou confiar que o frontend só enviará userId para rotas que o exigem
  // ou que o currentUser.id é enviado de alguma forma.
  // Uma abordagem mais robusta seria usar JWT e decodificar o userId do token.
  if (!userId && req.headers['x-user-id']) { // Exemplo de como um token JWT enviaria o userId
    userId = req.headers['x-user-id'];
  }


  if (!userId) {
    return res.status(401).json({ message: 'Autenticação necessária.' });
  }

  try {
    const user = await Usuario.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }
    // Verifica se o plano está ativo e não expirou
    if (!user.planoAtivo || (user.dataExpiracaoPlano && user.dataExpiracaoPlano < new Date())) {
      // Se o plano expirou, podemos opcionalmente desativá-lo aqui
      if (user.planoAtivo && user.dataExpiracaoPlano && user.dataExpiracaoPlano < new Date()) {
        user.planoAtivo = false;
        await user.save();
      }
      return res.status(403).json({ message: 'Seu plano não está ativo ou expirou. Por favor, assine para ter acesso completo.' });
    }
    next(); // Permite que a requisição continue
  } catch (error) {
    console.error('Erro no middleware checkSubscription:', error);
    res.status(500).json({ message: 'Erro de servidor ao verificar assinatura.', error: error.message });
  }
};


// Rotas de Autenticação e Usuário
app.post('/api/usuarios/register', async (req, res) => {
  try {
    const { email, senha, nomeEstabelecimento, telefoneWhatsapp } = req.body;

    const existingUser = await Usuario.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email já cadastrado.' });
    }

    // Por padrão, planoAtivo é false no schema
    const newUser = new Usuario({ email, senha, nomeEstabelecimento, telefoneWhatsapp });
    await newUser.save();
    // Retorna o ID do usuário para que o frontend possa iniciar o processo de assinatura
    res.status(201).json({ message: 'Usuário registrado com sucesso!', userId: newUser._id });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registrar usuário', error: error.message });
  }
});

app.post('/api/usuarios/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const user = await Usuario.findOne({ email, senha });
    if (!user) {
      return res.status(400).json({ message: 'Credenciais inválidas.' });
    }
    // Retorna o status do plano para o frontend decidir a navegação
    res.status(200).json({ message: 'Login bem-sucedido!', user: { id: user._id, email: user.email, nomeEstabelecimento: user.nomeEstabelecimento, planoAtivo: user.planoAtivo } });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao fazer login', error: error.message });
  }
});

// A rota de fetchUserInfo e updateUserInfo PRECISA estar acessível mesmo sem plano ativo,
// para que o usuário possa ver o status do plano ou atualizar informações básicas para o QR Code (logo, etc.)
// Apenas funcionalidades que dependem do cardápio ativo devem ser protegidas.
app.get('/api/usuarios/:id', async (req, res) => {
  try {
    const user = await Usuario.findById(req.params.id).select('-senha');
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar usuário', error: error.message });
  }
});

app.put('/api/usuarios/:id', async (req, res) => {
  try {
    const { email, senha, ...updateData } = req.body;
    // Se o frontend está tentando reativar o plano ou setar data de expiração,
    // essa lógica deve vir APENAS do webhook do Mercado Pago, não de um PUT direto.
    // Para o propósito deste exemplo, permitiremos a atualização, mas em produção,
    // você restringiria a modificação de 'planoAtivo' e 'dataExpiracaoPlano' a um webhook.
    const user = await Usuario.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-senha');
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }
    res.status(200).json({ message: 'Informações do usuário atualizadas com sucesso!', user });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar usuário', error: error.message });
  }
});


// Rota para criar preferência de pagamento (DEVE ser acessível mesmo sem plano, para que o usuário possa pagar)
app.post('/api/create-subscription-preference', async (req, res) => {
  try {
    const { planId, userId } = req.body;
    // Certifique-se de que o userId foi passado e é válido
    if (!userId) {
      return res.status(400).json({ message: 'ID do usuário é necessário para criar a preferência de pagamento.' });
    }

    let title = '';
    let unit_price = 0;
    let description = '';
    let expiration_days = 0;

    if (planId === 'monthly') {
      title = 'Assinatura Mensal - Cardápio Digital';
      unit_price = 29.90;
      description = 'Acesso mensal completo ao Cardápio Digital';
      expiration_days = 30;
    } else if (planId === 'annual') {
      title = 'Assinatura Anual - Cardápio Digital';
      unit_price = 290.90;
      description = 'Acesso anual completo ao Cardápio Digital com desconto';
      expiration_days = 365;
    } else {
      return res.status(400).json({ message: 'Plano inválido' });
    }

    const preference = new Preference(client);

    const body = {
      items: [
        {
          id: planId,
          title: title,
          description: description,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: unit_price,
        },
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL}/payment-status?status=success&plan=${planId}&userId=${userId}&expiration=${expiration_days}`, // Pass expiration days
        pending: `${process.env.FRONTEND_URL}/payment-status?status=pending&plan=${planId}&userId=${userId}`,
        failure: `${process.env.FRONTEND_URL}/payment-status?status=failure&plan=${planId}&userId=${userId}`,
      },
      auto_return: "approved",
      metadata: {
        userId: userId,
        planId: planId,
        expirationDays: expiration_days, // Pass expiration days to metadata for webhook
      },
      // notification_url: `${process.env.BACKEND_URL}/api/mercado-pago-webhook`, // Highly recommended for production
    };

    const response = await preference.create({ body });
    res.status(200).json({ checkoutUrl: response.init_point });

  } catch (error) {
    console.error('Erro ao criar preferência de pagamento do Mercado Pago:', error);
    res.status(500).json({ message: 'Erro ao gerar link de pagamento', error: error.message });
  }
});


// Rotas Protegidas por Assinatura (APLIQUE O MIDDLEWARE checkSubscription)
// O middleware checkSubscription será aplicado a todas essas rotas.
// Isso significa que qualquer requisição para essas rotas primeiro passará
// pelo checkSubscription e será bloqueada se o plano não estiver ativo/expirado.

app.get('/api/categorias/:usuarioId', checkSubscription, async (req, res) => {
  try {
    const categorias = await Categoria.find({ usuarioId: req.params.usuarioId }).sort({ ordem: 1 });
    res.json(categorias);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar categorias', error: error.message });
  }
});

app.post('/api/categorias', checkSubscription, async (req, res) => {
  try {
    const newCategoria = new Categoria(req.body);
    await newCategoria.save();
    res.status(201).json(newCategoria);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar categoria', error: error.message });
  }
});

app.put('/api/categorias/:id', checkSubscription, async (req, res) => {
  try {
    const categoria = await Categoria.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(categoria);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar categoria', error: error.message });
  }
});

app.delete('/api/categorias/:id', checkSubscription, async (req, res) => {
  try {
    await Produto.deleteMany({ categoriaId: req.params.id });
    await Categoria.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar categoria', error: error.message });
  }
});


app.get('/api/produtos/:usuarioId', checkSubscription, async (req, res) => {
  try {
    const produtos = await Produto.find({ usuarioId: req.params.usuarioId });
    res.json(produtos);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar produtos', error: error.message });
  }
});

app.get('/api/produtos/:usuarioId/:categoriaId', checkSubscription, async (req, res) => {
  try {
    const produtos = await Produto.find({
      usuarioId: req.params.usuarioId,
      categoriaId: req.params.categoriaId
    });
    res.json(produtos);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar produtos por categoria', error: error.message });
  }
});

app.post('/api/produtos', checkSubscription, async (req, res) => {
  try {
    const newProduto = new Produto(req.body);
    await newProduto.save();
    res.status(201).json(newProduto);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar produto', error: error.message });
  }
});

app.put('/api/produtos/:id', checkSubscription, async (req, res) => {
  try {
    const produto = await Produto.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(produto);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar produto', error: error.message });
  }
});

app.delete('/api/produtos/:id', checkSubscription, async (req, res) => {
  try {
    await Produto.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar produto', error: error.message });
  }
});


app.get('/api/pedidos/:usuarioId', checkSubscription, async (req, res) => {
  try {
    const pedidos = await Pedido.find({ usuarioId: req.params.usuarioId }).sort({ dataPedido: -1 });
    res.json(pedidos);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar pedidos', error: error.message });
  }
});

// A rota de POST de pedidos (criada pelo cliente) NÃO deve ser protegida por assinatura
// pois o cliente precisa conseguir fazer o pedido mesmo que o estabelecimento não tenha um plano ativo no momento da criação do cardápio.
// A restrição para o cliente acessar o cardápio (URL do QR Code) será no frontend.
app.post('/api/pedidos', async (req, res) => {
  try {
    const { usuarioId, itens, clienteNome, clienteTelefone, clienteEndereco, observacoes } = req.body;

    // Fetch user to get WhatsApp number and check if menu is active
    const usuario = await Usuario.findById(usuarioId);
    if (!usuario) {
      return res.status(404).json({ message: 'Usuário (estabelecimento) não encontrado.' });
    }
    // Opcional: Você pode adicionar uma verificação aqui se quiser que o cliente
    // SÓ CONSIGA FAZER PEDIDOS SE O PLANO DO ESTABELECIMENTO ESTIVER ATIVO.
    // Isso é uma decisão de negócio. Por enquanto, a rota de cardápio público já verifica.
    // if (!usuario.planoAtivo || (usuario.dataExpiracaoPlano && usuario.dataExpiracaoPlano < new Date())) {
    //   return res.status(403).json({ message: 'Desculpe, este estabelecimento está com o plano inativo e não pode receber pedidos no momento.' });
    // }

    let total = 0;
    const itensCompletos = [];

    for (const item of itens) {
      const produto = await Produto.findById(item.produtoId);
      if (!produto) {
        return res.status(404).json({ message: `Produto com ID ${item.produtoId} não encontrado.` });
      }

      let precoItem = produto.preco;
      const opcoesSelecionadas = [];

      if (item.opcoesSelecionadas && item.opcoesSelecionadas.length > 0) {
        item.opcoesSelecionadas.forEach(opcaoSelecionada => {
          const produtoOpcao = produto.opcoes.find(op => op.nomeOpcao === opcaoSelecionada.nomeOpcao);
          if (produtoOpcao && produtoOpcao.itens) {
            const itemDetalhe = produtoOpcao.itens.find(it => it.nomeItem === opcaoSelecionada.selecao);
            if (itemDetalhe) {
              precoItem += itemDetalhe.precoExtra || 0;
              opcoesSelecionadas.push({
                nomeOpcao: opcaoSelecionada.nomeOpcao,
                selecao: opcaoSelecionada.selecao,
                precoExtra: itemDetalhe.precoExtra || 0
              });
            } else if (opcaoSelecionada.tipo === 'quantidade') {
              opcoesSelecionadas.push({
                nomeOpcao: opcaoSelecionada.nomeOpcao,
                selecao: opcaoSelecionada.selecao,
                precoExtra: 0
              });
            }
          }
        });
      }

      total += precoItem * item.quantidade;
      itensCompletos.push({
        produtoId: produto._id,
        nomeProduto: produto.nome,
        precoUnitario: precoItem,
        quantidade: item.quantidade,
        observacoes: item.observacoes,
        opcoesSelecionadas: opcoesSelecionadas
      });
    }

    const newPedido = new Pedido({
      usuarioId,
      itens: itensCompletos,
      total,
      clienteNome,
      clienteTelefone,
      clienteEndereco,
      observacoes,
      status: 'pendente'
    });

    await newPedido.save();

    if (!usuario.telefoneWhatsapp) {
      return res.status(500).json({ message: 'Telefone WhatsApp do estabelecimento não configurado.' });
    }

    let mensagem = `*Novo Pedido - ${usuario.nomeEstabelecimento}*\\n\\n`;
    mensagem += `*Cliente:* ${newPedido.clienteNome}\\n`;
    mensagem += `*Telefone:* ${newPedido.clienteTelefone}\\n`;
    if (newPedido.clienteEndereco) mensagem += `*Endereço:* ${newPedido.clienteEndereco}\\n`;
    mensagem += `*Itens do Pedido:*\\n`;

    newPedido.itens.forEach(item => {
      mensagem += `- ${item.quantidade}x ${item.nomeProduto} (R$ ${item.precoUnitario.toFixed(2)})`;
      if (item.opcoesSelecionadas && item.opcoesSelecionadas.length > 0) {
        mensagem += `\\n  *Opções:*`;
        item.opcoesSelecionadas.forEach(opcao => {
          mensagem += `\\n  - ${opcao.nomeOpcao}: ${opcao.selecao}`;
          if (opcao.precoExtra > 0) mensagem += ` (+R$ ${opcao.precoExtra.toFixed(2)})`;
        });
      }
      if (item.observacoes) mensagem += `\\n  *Obs:* ${item.observacoes}`;
      mensagem += `\\n`;
    });

    mensagem += `\\n*Total:* R$ ${newPedido.total.toFixed(2)}`;
    if (newPedido.observacoes) mensagem += `\\n\\n*Observações Gerais:* ${newPedido.observacoes}`;
    mensagem += `\\n\\n*Status:* ${newPedido.status}`;

    const whatsappUrl = `https://wa.me/${usuario.telefoneWhatsapp}?text=${encodeURIComponent(mensagem)}`;
    res.status(201).json({ pedido: newPedido, whatsappUrl });
  } catch (error) {
    console.error('Erro ao criar pedido:', error);
    res.status(500).json({ message: 'Erro ao criar pedido', error: error.message });
  }
});


app.put('/api/pedidos/:id', checkSubscription, async (req, res) => {
  try {
    const pedido = await Pedido.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(pedido);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar pedido', error: error.message });
  }
});

app.delete('/api/pedidos/:id', checkSubscription, async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar pedido', error: error.message });
  }
});

// Rota para gerar QR Code (DEVE ser acessível mesmo sem plano para que o usuário possa gerar o link/QR para o cardápio público)
// O cardápio público em si é que fará a verificação do plano.
app.post('/api/generate-qr', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ message: 'URL é obrigatória.' });
  }
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(url);
    res.json({ qrCodeUrl: qrCodeDataUrl });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar QR Code', error: error.message });
  }
});

// Rotas para Cardápio Público (NÃO protegidas por checkSubscription, mas verificam o plano do estabelecimento)
// Essas rotas permitem que QUALQUER UM acesse o cardápio de um estabelecimento,
// mas o cardápio só será exibido se o plano do estabelecimento estiver ativo.
app.get('/api/public-menu/user/:ownerId', async (req, res) => {
  try {
    const user = await Usuario.findById(req.params.ownerId).select('-senha');
    if (!user) {
      return res.status(404).json({ message: 'Estabelecimento não encontrado.' });
    }
    // Verifica se o plano do estabelecimento está ativo e não expirou
    if (!user.planoAtivo || (user.dataExpiracaoPlano && user.dataExpiracaoPlano < new Date())) {
      // Opcional: desativar plano se expirado
      if (user.planoAtivo && user.dataExpiracaoPlano && user.dataExpiracaoPlano < new Date()) {
        user.planoAtivo = false;
        await user.save();
      }
      return res.status(403).json({ message: 'O cardápio deste estabelecimento está inativo no momento. Por favor, tente mais tarde.' });
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar dados do estabelecimento para cardápio público', error: error.message });
  }
});

app.get('/api/public-menu/categories/:ownerId', async (req, res) => {
  try {
    const categorias = await Categoria.find({ usuarioId: req.params.ownerId }).sort({ ordem: 1 });
    res.json(categorias);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar categorias para cardápio público', error: error.message });
  }
});

app.get('/api/public-menu/products/:ownerId', async (req, res) => {
  try {
    const produtos = await Produto.find({ usuarioId: req.params.ownerId });
    res.json(produtos);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar produtos para cardápio público', error: error.message });
  }
});


const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));