import { resolveExternalModuleAndFn } from 'graphql-codegen-plugin-helpers';
import {
  DEFAULT_SCALARS,
  indent,
  toPascalCase,
  DeclarationBlock,
  BasicFlowVisitor,
  ScalarsMap
} from 'graphql-codegen-flow';
import {
  ObjectTypeDefinitionNode,
  FieldDefinitionNode,
  NameNode,
  ListTypeNode,
  NonNullTypeNode,
  NamedTypeNode,
  InterfaceTypeDefinitionNode
} from 'graphql/language/ast';
import { FlowResolversPluginConfig } from './index';
import { GraphQLSchema, GraphQLInterfaceType, GraphQLObjectType } from 'graphql';

export interface ParsedConfig {
  scalars: ScalarsMap;
  convert: (str: string) => string;
  typesPrefix: string;
  contextType: string;
  mapping: { [typeName: string]: string };
}

export class FlowResolversVisitor implements BasicFlowVisitor {
  private _parsedConfig: ParsedConfig;

  constructor(pluginConfig: FlowResolversPluginConfig, private _schema: GraphQLSchema) {
    this._parsedConfig = {
      contextType: pluginConfig.contextType || 'any',
      mapping: pluginConfig.mapping || {},
      scalars: { ...DEFAULT_SCALARS, ...(pluginConfig.scalars || {}) },
      convert: pluginConfig.namingConvention ? resolveExternalModuleAndFn(pluginConfig.namingConvention) : toPascalCase,
      typesPrefix: pluginConfig.typesPrefix || ''
    };
  }

  get scalars(): ScalarsMap {
    return this._parsedConfig.scalars;
  }

  private _convertName(name: any, addPrefix = true): string {
    return (addPrefix ? this._parsedConfig.typesPrefix : '') + this._parsedConfig.convert(name);
  }

  Name = (node: NameNode): string => {
    return node.value;
  };

  ListType = (node: ListTypeNode): string => {
    const asString = (node.type as any) as string;

    return `?Array<${asString}>`;
  };

  NamedType = (node: NamedTypeNode): string => {
    const asString = (node.name as any) as string;
    const type =
      this._parsedConfig.mapping[asString] || this._parsedConfig.scalars[asString] || this._convertName(asString);

    return `?${type}`;
  };

  NonNullType = (node: NonNullTypeNode): string => {
    const asString = (node.type as any) as string;

    if (asString.charAt(0) === '?') {
      return asString.substr(1);
    }

    return asString;
  };

  FieldDefinition = (node: FieldDefinitionNode) => {
    const hasArguments = node.arguments && node.arguments.length > 0;

    return parentName => {
      const subscriptionType = this._schema.getSubscriptionType();
      const isSubscriptionType = subscriptionType && subscriptionType.name === parentName;

      return indent(
        `${node.name}?: ${isSubscriptionType ? 'SubscriptionResolver' : 'Resolver'}<${node.type}, ParentType, Context${
          hasArguments ? `, ${parentName + this._convertName(node.name, false) + 'Args'}` : ''
        }>,`
      );
    };
  };

  ObjectTypeDefinition = (node: ObjectTypeDefinitionNode) => {
    const name = this._convertName(node.name + 'Resolvers');
    const block = new DeclarationBlock()
      .export()
      .asKind('interface')
      .withName(name, `<Context = ${this._parsedConfig.contextType}, ParentType = ${node.name}>`)
      .withBlock(node.fields.map((f: any) => f(node.name)).join('\n'));

    return block.string;
  };

  InterfaceTypeDefinition = (node: InterfaceTypeDefinitionNode): string => {
    const name = this._convertName(node.name + 'Resolvers');
    const allTypesMap = this._schema.getTypeMap();
    const implementingTypes: string[] = [];

    for (const graphqlType of Object.values(allTypesMap)) {
      if (graphqlType instanceof GraphQLObjectType) {
        const allInterfaces = graphqlType.getInterfaces();
        if (allInterfaces.find(int => int.name === ((node.name as any) as string))) {
          implementingTypes.push(graphqlType.name);
        }
      }
    }

    return new DeclarationBlock()
      .export()
      .asKind('interface')
      .withName(name, `<Context = ${this._parsedConfig.contextType}, ParentType = ${node.name}>`)
      .withBlock(indent(`__resolveType: TypeResolveFn<${implementingTypes.map(name => `'${name}'`).join(' | ')}>`))
      .string;
  };
}
