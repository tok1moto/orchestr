import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { FulfillmentReportService } from '../services/fulfillmentReport.service';

export default async function fulfillmentRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/fulfillment (Batch export pending orders for label printing in CSV or JSON format)
  fastify.get('/api/fulfillment', async (request, reply) => {
    try {
      const query = (request.query as any) || {};
      const { status = 'pending', format = 'json' } = query;
      const sellerId = (request as any).sellerId || query.sellerId || '11111111-1111-1111-1111-111111111111';

      if (!fastify.pg) {
        const mockItems = [
          {
            id: 'ord-1001',
            sellerId,
            orderNumber: '#SH-9401',
            externalOrderId: '9401',
            channelId: 'chan-111',
            channelName: 'Acme Shopify Store',
            channelType: 'shopify',
            customerName: 'Eleanor Vance',
            customerEmail: 'eleanor@example.com',
            itemsCount: 2,
            lineItemsSummary: 'Wireless Ergonomic Mouse (x2) [SKU: PROD-MOUSE-001]',
            totalPrice: 179.98,
            currency: 'USD',
            financialStatus: 'paid',
            fulfillmentStatus: 'unfulfilled',
            status: status || 'pending',
            trackingNumber: '',
            trackingCompany: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];

        if (format.toLowerCase() === 'csv' || request.headers.accept?.includes('text/csv')) {
          const csv = FulfillmentReportService.convertToCSV(mockItems as any);
          reply.header('Content-Type', 'text/csv; charset=utf-8');
          reply.header('Content-Disposition', 'attachment; filename="fulfillment-report.csv"');
          return reply.send(csv);
        }

        return reply.status(200).send({
          statusCode: 200,
          total: mockItems.length,
          orders: mockItems,
        });
      }

      const report = await FulfillmentReportService.getFulfillmentReport(fastify.pg, sellerId, {
        status,
        format,
      });

      if (format.toLowerCase() === 'csv' || request.headers.accept?.includes('text/csv')) {
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', 'attachment; filename="fulfillment-report.csv"');
        return reply.send(report.csv);
      }

      return reply.status(200).send({
        statusCode: 200,
        total: report.total,
        orders: report.items,
      });
    } catch (err: any) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: err.message || 'Failed to generate fulfillment report',
      });
    }
  });
}
