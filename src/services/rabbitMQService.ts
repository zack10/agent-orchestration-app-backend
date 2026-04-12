import { connect, Connection, Channel, ConsumeMessage, ChannelModel } from 'amqplib';
import dotenv from 'dotenv';

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
export const AGENT_EXCHANGE = 'agent_exchange';

class RabbitMQService {
  private static instance: RabbitMQService;
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private model: ChannelModel | null = null;

  private constructor() {}

  public static getInstance(): RabbitMQService {
    if (!RabbitMQService.instance) {
      RabbitMQService.instance = new RabbitMQService();
    }
    return RabbitMQService.instance;
  }

  public async connect(): Promise<void> {
    if (this.connection) return;

    try {
      this.model = await connect(RABBITMQ_URL);
      this.connection = this.model.connection;
      this.channel = await this.model.createChannel();
      
      await this.channel.assertExchange(AGENT_EXCHANGE, 'topic', { durable: true });
      
      console.log('Connected to RabbitMQ');

      this.connection.on('error', (err) => {
        console.error('RabbitMQ Connection Error', err);
        this.connection = null;
        this.channel = null;
        this.model = null;
      });

      this.connection.on('close', () => {
        console.warn('RabbitMQ Connection Closed');
        this.connection = null;
        this.channel = null;
        this.model = null;
      });
    } catch (error) {
      console.error('Failed to connect to RabbitMQ', error);
      throw error;
    }
  }

  public async getChannel(): Promise<Channel> {
    if (!this.channel) {
      await this.connect();
    }
    if (!this.channel) {
      throw new Error('Could not establish RabbitMQ channel');
    }
    return this.channel;
  }

  public async publish(routingKey: string, message: any): Promise<void> {
    const channel = await this.getChannel();
    channel.publish(
      AGENT_EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      { persistent: true }
    );
  }

  public async subscribe(queueName: string, routingKey: string, onMessage: (msg: any) => void): Promise<void> {
    const channel = await this.getChannel();
    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, AGENT_EXCHANGE, routingKey);
    
    channel.consume(queueName, (msg: ConsumeMessage | null) => {
      if (msg) {
        const content = JSON.parse(msg.content.toString());
        onMessage(content);
        channel.ack(msg);
      }
    });
  }
}

export default RabbitMQService.getInstance();
