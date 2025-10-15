import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import pino from 'pino'
import agentsRouter from './routes/agents'

dotenv.config()

const logger = pino()
const app = express()
app.use(cors())
app.use(express.json())
app.use('/api/agents', agentsRouter)

const port = process.env.PORT || 3000
app.listen(port, () => {
  logger.info(`Server listening on http://localhost:${port}`)
})

export default app
