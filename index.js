// index.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const QRCode = require('qrcode');
const path = require('path');
const { MercadoPagoConfig, Preference } = require('mercadopago'); // Added Mercado Pago import

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
  redesSocial: [String], // Changed from redesSociais for consistency, check your frontend
  mensagemBoasVindas: String,
  corPrimaria: { type: String, default: '#4F46E5' },
  logoUrl: String,
  qrCodeUrl: String,
  planoAtivo: { type: Boolean, default: false }, // New field for subscription status
  dataExpiracaoPlano: { type: Date, default: null }, // New field for plan expiration
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
    min: { type: Number, default: 1 }, // Minimo de seleções para 'multipla_escolha'
    max: { type: Number, default: 1 }, // Maximo de seleções para 'multipla_escolha'
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
      selecao: String, // Pode ser o nome do item selecionado ou uma string para quantidade
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


// Rotas de Autenticação e Usuário (Existing Routes)
app.post('/api/usuarios/register', async (req, res) => {
  try {
    const { email, senha, nomeEstabelecimento, telefoneWhatsapp } = req.body;

    const existingUser = await Usuario.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email já cadastrado.' });
    }

    const newUser = new Usuario({ email, senha, nomeEstabelecimento, telefoneWhatsapp });
    await newUser.save();
    res.status(201).json({ message: 'Usuário registrado com sucesso!' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registrar usuário', error: error.message });
  }
});

app.post('/api/usuarios/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const user = await Usuario.findOne({ email, senha }); // Em um app real, use hash de senha
    if (!user) {
      return res.status(400).json({ message: 'Credenciais inválidas.' });
    }
    // Em um app real, retorne um token JWT
    res.status(200).json({ message: 'Login bem-sucedido!', user: { id: user._id, email: user.email, nomeEstabelecimento: user.nomeEstabelecimento, planoAtivo: user.planoAtivo } });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao fazer login', error: error.message });
  }
});

app.get('/api/usuarios/:id', async (req, res) => {
  try {
    const user = await Usuario.findById(req.params.id).select('-senha'); // Não retornar a senha
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
    const { email, senha, ...updateData } = req.body; // Remove password from direct update
    const user = await Usuario.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-senha');
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }
    res.status(200).json({ message: 'Informações do usuário atualizadas com sucesso!', user });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar usuário', error: error.message });
  }
});


// New route for creating Mercado Pago subscription preference
app.post('/api/create-subscription-preference', async (req, res) => {
  try {
    const { planId, userId } = req.body; // 'monthly' or 'annual' and userId
    let title = '';
    let unit_price = 0;
    let description = '';

    if (planId === 'monthly') {
      title = 'Assinatura Mensal - Cardápio Digital';
      unit_price = 29.90;
      description = 'Acesso mensal completo ao Cardápio Digital';
    } else if (planId === 'annual') {
      title = 'Assinatura Anual - Cardápio Digital';
      unit_price = 290.90;
      description = 'Acesso anual completo ao Cardápio Digital com desconto';
    } else {
      return res.status(400).json({ message: 'Plano inválido' });
    }

    const preference = new Preference(client);

    const body = {
      items: [
        {
          id: planId, // This can be used to identify the plan in your webhook
          title: title,
          description: description,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: unit_price,
        },
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL}/payment-status?status=success&plan=${planId}&userId=${userId}`,
        pending: `${process.env.FRONTEND_URL}/payment-status?status=pending&plan=${planId}&userId=${userId}`,
        failure: `${process.env.FRONTEND_URL}/payment-status?status=failure&plan=${planId}&userId=${userId}`,
      },
      auto_return: "approved",
      // You can also add metadata if needed to link payment to your user
      metadata: {
        userId: userId, // Pass the userId to Mercado Pago to identify the user
        planId: planId,
      },
      // Optional: Payer information if you have it
      // payer: {
      //   name: "Nome do Cliente",
      //   surname: "Sobrenome",
      //   email: "cliente@example.com",
      //   phone: {
      //     area_code: "11",
      //     number: "999999999"
      //   },
      //   address: {
      //     zip_code: "06233200",
      //     street_name: "Av. das Nações Unidas",
      //     street_number: "3003"
      //   }
      // },
      // notification_url: `${process.env.BACKEND_URL}/api/mercado-pago-webhook`, // IMPORTANT: For production, set up a webhook
    };

    const response = await preference.create({ body });
    res.status(200).json({ checkoutUrl: response.init_point });

  } catch (error) {
    console.error('Erro ao criar preferência de pagamento do Mercado Pago:', error);
    res.status(500).json({ message: 'Erro ao gerar link de pagamento', error: error.message });
  }
});


// Optional: Mercado Pago Webhook (Highly recommended for production)
// This route would listen for notifications from Mercado Pago about payment status
// app.post('/api/mercado-pago-webhook', async (req, res) => {
//   // Implement logic to handle payment notifications
//   // Verify signature, process payment status, update user's plan status in DB
//   console.log('Mercado Pago Webhook Received:', req.body);
//   res.status(200).send('OK');
// });


// Rotas de Categoria (Existing Routes)
app.get('/api/categorias/:usuarioId', async (req, res) => {
  try {
    const categorias = await Categoria.find({ usuarioId: req.params.usuarioId }).sort({ ordem: 1 });
    res.json(categorias);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar categorias', error: error.message });
  }
});

app.post('/api/categorias', async (req, res) => {
  try {
    const newCategoria = new Categoria(req.body);
    await newCategoria.save();
    res.status(201).json(newCategoria);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar categoria', error: error.message });
  }
});

app.put('/api/categorias/:id', async (req, res) => {
  try {
    const categoria = await Categoria.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(categoria);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar categoria', error: error.message });
  }
});

app.delete('/api/categorias/:id', async (req, res) => {
  try {
    // Delete associated products first
    await Produto.deleteMany({ categoriaId: req.params.id });
    await Categoria.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar categoria', error: error.message });
  }
});


// Rotas de Produto (Existing Routes)
app.get('/api/produtos/:usuarioId', async (req, res) => {
  try {
    const produtos = await Produto.find({ usuarioId: req.params.usuarioId });
    res.json(produtos);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar produtos', error: error.message });
  }
});

app.get('/api/produtos/:usuarioId/:categoriaId', async (req, res) => {
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

app.post('/api/produtos', async (req, res) => {
  try {
    const newProduto = new Produto(req.body);
    await newProduto.save();
    res.status(201).json(newProduto);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar produto', error: error.message });
  }
});

app.put('/api/produtos/:id', async (req, res) => {
  try {
    const produto = await Produto.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(produto);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar produto', error: error.message });
  }
});

app.delete('/api/produtos/:id', async (req, res) => {
  try {
    await Produto.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar produto', error: error.message });
  }
});


// Rotas de Pedido (Existing Routes)
app.get('/api/pedidos/:usuarioId', async (req, res) => {
  try {
    const pedidos = await Pedido.find({ usuarioId: req.params.usuarioId }).sort({ dataPedido: -1 });
    res.json(pedidos);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar pedidos', error: error.message });
  }
});

app.post('/api/pedidos', async (req, res) => {
  try {
    const { usuarioId, itens, clienteNome, clienteTelefone, clienteEndereco, observacoes } = req.body;

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
            } else if (opcaoSelecionada.tipo === 'quantidade') { // Handle quantity type options
              opcoesSelecionadas.push({
                nomeOpcao: opcaoSelecionada.nomeOpcao,
                selecao: opcaoSelecionada.selecao, // Assuming selecao holds the quantity value
                precoExtra: 0 // Quantity type might not have extra price per unit
              });
            }
          }
        });
      }

      total += precoItem * item.quantidade;
      itensCompletos.push({
        produtoId: produto._id,
        nomeProduto: produto.nome,
        precoUnitario: precoItem, // Use the adjusted price
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

    // Buscar informações do usuário para o WhatsApp
    const usuario = await Usuario.findById(usuarioId);
    if (!usuario || !usuario.telefoneWhatsapp) {
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
      mensagem += `\\n`; // Adiciona uma nova linha para cada item
    });

    mensagem += `\\n*Total:* R$ ${newPedido.total.toFixed(2)}`;
    if (newPedido.observacoes) mensagem += `\\n\\n*Observações Gerais:* ${newPedido.observacoes}`;
    mensagem += `\\n\\n*Status:* ${newPedido.status}`; // Adiciona o status do pedido

    // Retornar link do WhatsApp
    const whatsappUrl = `https://wa.me/${usuario.telefoneWhatsapp}?text=${encodeURIComponent(mensagem)}`;
    res.status(201).json({ pedido: newPedido, whatsappUrl });
  } catch (error) {
    console.error('Erro ao criar pedido:', error);
    res.status(500).json({ message: 'Erro ao criar pedido', error: error.message });
  }
});


app.put('/api/pedidos/:id', async (req, res) => {
  try {
    const pedido = await Pedido.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(pedido);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar pedido', error: error.message });
  }
});

app.delete('/api/pedidos/:id', async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar pedido', error: error.message });
  }
});


// Rota para gerar QR Code
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

// Serve static files from the 'public' directory (if you have one for client-side)
// app.use(express.static(path.join(__dirname, 'public')));


const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));