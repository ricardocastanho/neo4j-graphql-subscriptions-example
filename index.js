import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import neo4j from "neo4j-driver";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { createClient } from "redis";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
// import { ApolloServerPluginLandingPageGraphQLPlayground } from "@apollo/server-plugin-landing-page-graphql-playground";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { useServer } from "graphql-ws/lib/use/ws";
import {
  Neo4jGraphQL,
  Neo4jGraphQLSubscriptionsSingleInstancePlugin,
} from "@neo4j/graphql";
import { EventEmitter } from "events";

const HOST = "localhost";
const PATH = "/graphql";
const PORT = 4001;
const NEO4J_URL = "bolt://34.232.46.151:7687";
const NEO4J_USER = "neo4j";
const NEO4J_PASSWORD = "itinerary-gallon-holddown";
const REDIS_URL = "redis://root:root@localhost:6357";

const typeDefs = `
  type Movie {
    id: ID!
    title: String!
    released: Int
    actors: [Actor!]! @relationship(type: "ACTED_IN", direction: OUT)
  }

  type Actor {
    id: ID!
    name: String!
    movies: [Movie!]! @relationship(type: "ACTED_IN", direction: IN)
  }
`;

const driver = neo4j.driver(
  NEO4J_URL,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD)
);

class CustomRedisSubscriptionPlugin {
  constructor(redisClient) {
    this.client = redisClient;
    this.events = new EventEmitter();
  }

  async init() {
    this.subscriber = this.client.duplicate();
    this.publisher = this.client.duplicate();
    await this.subscriber.connect();
    await this.publisher.connect();
    await this.subscriber.subscribe("graphql-api-subscriptions", (message) => {
      const eventMeta = JSON.parse(message);
      this.events.emit(eventMeta.event, eventMeta);
    });
  }

  async publish(eventMeta) {
    await this.publisher.publish(
      "graphql-api-subscriptions",
      JSON.stringify(eventMeta)
    );
  }
}

const neo4jGraphQL = new Neo4jGraphQL({
  typeDefs,
  driver,
  plugins: {
    subscriptions: new Neo4jGraphQLSubscriptionsSingleInstancePlugin(),
  },
});

async function main() {
  // const client = createClient(REDIS_URL);
  // client.on("error", (err) => console.log("Redis Client Error", err));
  // await client.connect();

  // const redisSubscriptions = new CustomRedisSubscriptionPlugin(client);
  // await redisSubscriptions.init();

  const app = express();
  const httpServer = createServer(app);
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: PATH,
  });

  const schema = await neo4jGraphQL.getSchema();

  const serverCleanup = useServer(
    {
      schema,
      context: (ctx) => {
        return ctx;
      },
    },
    wsServer
  );

  const server = new ApolloServer({
    schema: schema,
    playground: true,
    plugins: [
      // ApolloServerPluginLandingPageGraphQLPlayground(),
      ApolloServerPluginDrainHttpServer({
        httpServer,
      }),
      {
        async serverWillStart() {
          return Promise.resolve({
            async drainServer() {
              await serverCleanup.dispose();
            },
          });
        },
      },
    ],
  });

  await server.start();

  app.use(
    PATH,
    cors(),
    bodyParser.json(),
    expressMiddleware(server, {
      context: async ({ req }) => ({ req }),
    })
  );

  httpServer.listen({ port: PORT }, () => {
    console.log(`GraphQL server ready at http://${HOST}:${PORT}${PATH}`);
    console.log(`Subscriptions ready at ws://${HOST}:${PORT}${PATH}`);
  });

  app.get("/ping", (req, res) => {
    res.status(200).send("pong!");
  });
}

main();
