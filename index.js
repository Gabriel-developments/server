require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const QRCode = require('qrcode');
const path = require('path');

// Configuração do app
const app = express();
app.use(cors());
app.use(express.json());

// Conexão com MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cardapio-digital')
  .then(() => console.log('Conectado ao MongoDB'))
  .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// Modelos
const Usuario = mongoose.model('Usuario', new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  senha: { type: String, required: true },
  nomeEstabelecimento: String,
  telefoneWhatsapp: String,
  endereco: String,
  horarioFuncionamento: String,
  redesSociais: [String],
  mensagemBoasVindas: String,
  corPrimaria: { type: String, default: '#4F46E5' },
  logoUrl: String,
  qrCodeUrl: String,
  createdAt: { type: Date, default: Date.now }
}));

const Categoria = mongoose.model('Categoria', new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  nome: { type: String, required: true },
  ordem: { type: Number, default: 0 },
  ativa: { type: Boolean, default: true }
}));

const Item = mongoose.model('Item', new mongoose.Schema({
  categoriaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Categoria', required: true },
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  nome: { type: String, required: true },
  descricao: String,
  preco: { type: Number, required: true },
  imagemUrl: String,
  disponivel: { type: Boolean, default: true },
  opcoes: [{
    nome: String,
    tipo: { type: String, enum: ['multipla', 'unica', 'adicional', 'observacao'] },
    obrigatorio: Boolean,
    itens: [{
      nome: String,
      precoExtra: Number
    }]
  }],
  ordem: { type: Number, default: 0 }
}));

const Pedido = mongoose.model('Pedido', new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  clienteNome: String,
  clienteTelefone: String,
  clienteEndereco: String,
  itens: [{
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
    nome: String,
    quantidade: { type: Number, default: 1 },
    precoUnitario: Number,
    opcoesSelecionadas: [{
      nomeOpcao: String,
      selecao: String,
      precoExtra: Number
    }],
    observacoes: String
  }],
  total: Number,
  observacoes: String,
  status: { type: String, default: 'Recebido', enum: ['Recebido', 'Em Preparo', 'Pronto', 'Entregue', 'Cancelado'] },
  createdAt: { type: Date, default: Date.now }
}));

// Rotas de Autenticação
app.post('/api/registrar', async (req, res) => {
  try {
    const { email, senha, nomeEstabelecimento, telefoneWhatsapp } = req.body;
    const usuarioExistente = await Usuario.findOne({ email });
    if (usuarioExistente) return res.status(400).json({ message: 'Email já cadastrado' });

    const usuario = new Usuario({ email, senha, nomeEstabelecimento, telefoneWhatsapp });
    await usuario.save();

    // Gerar URL única e QR Code
    const urlCardapio = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/cardapio/${usuario._id}`;
    const qrCodeUrl = await QRCode.toDataURL(urlCardapio);
    usuario.qrCodeUrl = qrCodeUrl;
    await usuario.save();

    res.status(201).json({ usuario, urlCardapio, qrCodeUrl });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registrar usuário', error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const usuario = await Usuario.findOne({ email, senha });
    if (!usuario) return res.status(401).json({ message: 'Credenciais inválidas' });
    res.json(usuario);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao fazer login', error: error.message });
  }
});

// Rotas do Cardápio
app.get('/api/usuarios/:id', async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ message: 'Usuário não encontrado' });
    res.json(usuario);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar usuário', error: error.message });
  }
});

app.put('/api/usuarios/:id', async (req, res) => {
  try {
    const usuario = await Usuario.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(usuario);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar usuário', error: error.message });
  }
});

// Rotas de Categorias
app.get('/api/usuarios/:usuarioId/categorias', async (req, res) => {
  try {
    const categorias = await Categoria.find({ usuarioId: req.params.usuarioId }).sort('ordem');
    res.json(categorias);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar categorias', error: error.message });
  }
});

app.post('/api/categorias', async (req, res) => {
  try {
    const categoria = new Categoria(req.body);
    await categoria.save();
    res.status(201).json(categoria);
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
    await Categoria.findByIdAndDelete(req.params.id);
    await Item.deleteMany({ categoriaId: req.params.id });
    res.json({ message: 'Categoria e itens relacionados removidos' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover categoria', error: error.message });
  }
});

// Rotas de Itens
app.get('/api/categorias/:categoriaId/itens', async (req, res) => {
  try {
    const itens = await Item.find({ categoriaId: req.params.categoriaId }).sort('ordem');
    res.json(itens);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar itens', error: error.message });
  }
});

app.post('/api/itens', async (req, res) => {
  try {
    const item = new Item(req.body);
    await item.save();
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar item', error: error.message });
  }
});

app.put('/api/itens/:id', async (req, res) => {
  try {
    const item = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar item', error: error.message });
  }
});

app.delete('/api/itens/:id', async (req, res) => {
  try {
    await Item.findByIdAndDelete(req.params.id);
    res.json({ message: 'Item removido' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover item', error: error.message });
  }
});

// Rotas de Pedidos
app.get('/api/usuarios/:usuarioId/pedidos', async (req, res) => {
  try {
    const pedidos = await Pedido.find({ usuarioId: req.params.usuarioId }).sort('-createdAt');
    res.json(pedidos);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar pedidos', error: error.message });
  }
});

app.post('/api/pedidos', async (req, res) => {
  try {
    const pedido = new Pedido(req.body);
    await pedido.save();
    
    // Buscar usuário para obter telefone do WhatsApp
    const usuario = await Usuario.findById(pedido.usuarioId);
    
    // Formatar mensagem para WhatsApp
    let mensagem = `*Novo Pedido - ${usuario.nomeEstabelecimento}*\n\n`;
    mensagem += `*Cliente:* ${pedido.clienteNome}\n`;
    mensagem += `*Telefone:* ${pedido.clienteTelefone}\n`;
    if (pedido.clienteEndereco) mensagem += `*Endereço:* ${pedido.clienteEndereco}\n`;
    mensagem += `\n*Itens do Pedido:*\n`;
    
    pedido.itens.forEach(item => {
      mensagem += `\n- ${item.nome} (x${item.quantidade}) - R$ ${(item.precoUnitario * item.quantidade).toFixed(2)}`;
      if (item.opcoesSelecionadas && item.opcoesSelecionadas.length > 0) {
        mensagem += `\n  *Opções:*`;
        item.opcoesSelecionadas.forEach(opcao => {
          mensagem += `\n  - ${opcao.nomeOpcao}: ${opcao.selecao}`;
          if (opcao.precoExtra > 0) mensagem += ` (+R$ ${opcao.precoExtra.toFixed(2)})`;
        });
      }
      if (item.observacoes) mensagem += `\n  *Obs:* ${item.observacoes}`;
    });
    
    mensagem += `\n\n*Total:* R$ ${pedido.total.toFixed(2)}`;
    if (pedido.observacoes) mensagem += `\n\n*Observações Gerais:* ${pedido.observacoes}`;
    
    // Retornar link do WhatsApp
    const whatsappUrl = `https://wa.me/${usuario.telefoneWhatsapp}?text=${encodeURIComponent(mensagem)}`;
    res.status(201).json({ pedido, whatsappUrl });
  } catch (error) {
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

// Servir frontend em produção
if (process.env.NODE_ENV === 'production') {
  // Serve static files from the 'build' directory
  app.use(express.static(path.join(__dirname, '../client/build')));

  // For any other GET request, serve the index.html file
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../client/build', 'index.html'));
  });
}

// Iniciar servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));