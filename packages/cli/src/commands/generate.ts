import {Command} from '../command'
import {flags} from '@oclif/command'
import * as fs from 'fs'
import * as path from 'path'
import enquirer from 'enquirer'
import _pluralize from 'pluralize'
import {PageGenerator, MutationGenerator, QueryGenerator /* ModelGenerator */} from '@blitzjs/generator'
import {PromptAbortedError} from '../errors/prompt-aborted'
import {log} from '@blitzjs/server'
import camelCase from 'camelcase'
const debug = require('debug')('blitz:generate')

const pascalCase = (str: string) => camelCase(str, {pascalCase: true})

enum ResourceType {
  All = 'all',
  Crud = 'crud',
  Mutation = 'mutations',
  Page = 'pages',
  Query = 'queries',
  // Resource = 'resource',
}

interface Flags {
  context?: string
  'dry-run'?: boolean
}

interface Args {
  type: ResourceType
  model: string
}

function pluralize(input: string): string {
  return _pluralize.isPlural(input) ? input : _pluralize.plural(input)
}

function singular(input: string): string {
  return _pluralize.isSingular(input) ? input : _pluralize.singular(input)
}

function modelName(input: string) {
  return camelCase(singular(input))
}
function modelNames(input: string) {
  return camelCase(pluralize(input))
}
function ModelName(input: string) {
  return pascalCase(singular(input))
}
function ModelNames(input: string) {
  return pascalCase(pluralize(input))
}

const generatorMap = {
  [ResourceType.All]: [/*ModelGenerator*/ PageGenerator, QueryGenerator, MutationGenerator],
  [ResourceType.Crud]: [MutationGenerator, QueryGenerator],
  [ResourceType.Mutation]: [MutationGenerator],
  [ResourceType.Page]: [PageGenerator],
  [ResourceType.Query]: [QueryGenerator],
  // [ResourceType.Resource]: [/*ModelGenerator*/ QueryGenerator, MutationGenerator],
}

export class Generate extends Command {
  static description = 'Generate new files for your Blitz project'

  static aliases = ['g']

  static args = [
    {
      name: 'type',
      required: true,
      description: 'What files to generate',
      options: [
        ResourceType.All,
        // ResourceType.Resource,
        ResourceType.Crud,
        ResourceType.Query,
        ResourceType.Mutation,
        ResourceType.Page,
      ],
    },
    {
      name: 'model',
      required: true,
      description: 'The name of your model, like "user". Can be singular or plural - same result',
    },
  ]

  static flags = {
    help: flags.help({char: 'h'}),
    // context: flags.string({
    //   char: 'c',
    //   description:
    //     'The parent folder for nested generation. For example, generating `products` within a `store` would supply `-c store`. For nested contexts you may supply the full path.',
    // }),
    'dry-run': flags.boolean({
      char: 'd',
      description: 'Show what files will be created without writing them to disk',
    }),
  }

  static examples = [
    `# The 'crud' type will generate all queries & mutations for a model
> blitz generate crud productVariant
    `,
    `# The 'all' generator will scaffold out everything possible for a model
> blitz generate all products
    `,
  ]

  async promptForTargetDirectory(paths: string[]): Promise<string> {
    return enquirer
      .prompt<{directory: string}>({
        name: 'directory',
        type: 'select',
        message: 'Please select a target directory:',
        choices: paths,
      })
      .then((resp) => resp.directory)
  }

  async genericConfirmPrompt(message: string): Promise<boolean> {
    return enquirer
      .prompt<{continue: string}>({
        name: 'continue',
        type: 'select',
        message: message,
        choices: ['Yes', 'No'],
      })
      .then((resp) => resp.continue === 'Yes')
  }

  async handleNoContext(message: string): Promise<void> {
    const shouldCreateNewRoot = await this.genericConfirmPrompt(message)
    if (!shouldCreateNewRoot) {
      log.error('Could not determine proper location for files. Aborting.')
      this.exit(0)
    }
  }

  async run() {
    const {args, flags}: {args: Args; flags: Flags} = this.parse(Generate)
    debug('args: ', args)
    debug('flags: ', flags)

    const isInRoot = fs.existsSync(path.resolve('blitz.config.js'))

    if (!isInRoot) {
      log.error('No blitz.config.js found. `generate` must be run from the root of the project.')
      this.exit(1)
    }

    try {
      let singularRootContext: string

      if (!flags.context) {
        if (fs.existsSync(path.resolve('app', pluralize(args.model)))) {
          singularRootContext = modelName(args.model)
        } else {
          singularRootContext = modelName(args.model)
        }
      } else {
        // use [\\/] as the separator to match UNIX and Windows path formats
        const contextParts = flags.context.split(/[\\/]/)
        if (contextParts.length === 0) {
          await this.handleNoContext(
            `Couldn't determine context from context flag. Would you like to create a new context folder under /app for '${pluralize(
              args.model,
            )}'?`,
          )
          singularRootContext = modelName(args.model)
        } else {
          singularRootContext = modelName(args.model)
        }
      }

      const generators = generatorMap[args.type]
      for (const GeneratorClass of generators) {
        const generator = new GeneratorClass({
          destinationRoot: path.resolve(),
          modelName: modelName(singularRootContext),
          modelNames: modelNames(singularRootContext),
          ModelName: ModelName(singularRootContext),
          ModelNames: ModelNames(singularRootContext),
          dryRun: flags['dry-run'],
          useTs: fs.existsSync(path.resolve('tsconfig.json')),
        })
        await generator.run()
      }

      console.log(' ') // new line
    } catch (err) {
      if (err instanceof PromptAbortedError) this.exit(0)

      log.error(err)
      this.exit(1)
    }
  }
}
