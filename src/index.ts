import express, { Request, Response } from 'express';
import cors from 'cors';
import agentRoutes from './routes/agentRoutes';
import skillRoutes from './routes/skillRoutes';
import taskRoutes from './routes/taskRoutes';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/agents', agentRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/tasks', taskRoutes);

app.get('/', (req: Request, res: Response) => {
  res.send('Agent Orchestration API is running');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
